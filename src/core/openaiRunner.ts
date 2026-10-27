import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from './logger';
import { readJson, writeFileAtomic } from './store';
import type { TurnRequest, TurnRunner, TurnSink } from './runner';
import { APP_VERSION } from '../shared/version';

/** Best first. The first one the key can use becomes the default brain. */
export const OPENAI_MODEL_PREFERENCE = ['gpt-5.5', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o'];

const MAX_STEPS = 80;
const HISTORY_LIMIT = 120;
const TOOL_OUTPUT_LIMIT = 30_000;

/** Our local tools, and the permission name each one is checked under. */
const LOCAL_TOOLS: { tool: ChatCompletionTool; permission: string }[] = [
  {
    permission: 'Read',
    tool: fn('read_file', 'Read a text file. Paths may be absolute or relative to your folder.', {
      path: { type: 'string' },
      offset: { type: 'number', description: 'First line to read (1-based), optional' },
      limit: { type: 'number', description: 'How many lines to read, optional' },
    }, ['path']),
  },
  {
    permission: 'Write',
    tool: fn('write_file', 'Create or overwrite a file with the given content.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  },
  {
    permission: 'Edit',
    tool: fn('edit_file', 'Replace one exact piece of text in a file. old_text must appear exactly once.', {
      path: { type: 'string' },
      old_text: { type: 'string' },
      new_text: { type: 'string' },
    }, ['path', 'old_text', 'new_text']),
  },
  {
    permission: 'Glob',
    tool: fn('list_files', 'List files and folders in a directory.', { path: { type: 'string', description: 'Directory, default: your folder' } }, []),
  },
  {
    permission: 'Grep',
    tool: fn('search_files', 'Find lines containing some text in files under a directory.', {
      text: { type: 'string' },
      path: { type: 'string', description: 'Directory to search, default: your folder' },
    }, ['text']),
  },
  {
    permission: process.platform === 'win32' ? 'PowerShell' : 'Bash',
    tool: fn('run_command', `Run a ${process.platform === 'win32' ? 'PowerShell' : 'bash'} command on this computer and get its output.`, {
      command: { type: 'string' },
      timeout_seconds: { type: 'number', description: 'Default 120' },
    }, ['command']),
  },
  {
    permission: 'WebSearch',
    tool: fn(
      'web_search',
      'Search the web and get a short answer with source links in one step. Use this first for any fact, news, price, video or page you need to find; it is much faster than opening the browser.',
      { query: { type: 'string', description: 'What to find, in plain words' } },
      ['query'],
    ),
  },
  {
    permission: 'WebFetch',
    tool: fn('fetch_url', 'Download a web page or API response and return its text.', { url: { type: 'string' } }, ['url']),
  },
];

/** Fast models given OpenAI's built-in web search tool, fastest first (gpt-4.1-mini: ~3 s per search, measured). */
const SEARCH_TOOL_MODELS: { model: string; effort?: 'low' }[] = [{ model: 'gpt-4.1-mini' }, { model: 'gpt-5.4-nano', effort: 'low' }, { model: 'gpt-5.4-mini', effort: 'low' }];
/** Older models that search by themselves, used only if none of the above is available. */
const SEARCH_MODELS = ['gpt-5-search-api', 'gpt-4o-mini-search-preview', 'gpt-4o-search-preview'];
/** Connections to apps and the browser stay open this long after an agent's last message. */
const WARM_MS = 15 * 60 * 1000;

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatCompletionTool {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}

interface McpHandle {
  client: Client;
  server: string;
  tools: Map<string, string>;
  /** Tool definitions, listed once per connection. */
  listed?: ChatCompletionTool[];
  /** Set when the connection closes, so the next turn reconnects. */
  dead?: boolean;
}

interface WarmConnection {
  handle: McpHandle;
  lastUsed: number;
}

export interface OpenAIRunnerOptions {
  apiKey: () => string | undefined;
  sessionsDir: string;
  log: Logger;
}

/**
 * Runs agent turns on OpenAI models. It gives the model the same abilities
 * the Claude engine has: files, commands, the web, every connected MCP app,
 * and the frog team tools, all behind the same approval gate.
 */
export class OpenAIRunner implements TurnRunner {
  private models: string[] | null = null;
  private allModelIds: string[] = [];
  private retiredSearch = new Set<string>();
  /** Open app/browser connections per agent, reused across messages (no cold start each time). */
  private warm = new Map<string, WarmConnection>();

  constructor(private opts: OpenAIRunnerOptions) {}

  /** Close one agent's kept-open connections (e.g. so its browser profile can be opened by the user). */
  async release(agentId: string) {
    const mine = [...this.warm.entries()].filter(([key]) => key.startsWith(`${agentId}|`));
    for (const [key] of mine) this.warm.delete(key);
    await Promise.all(mine.map(([, w]) => w.handle.client.close().catch(() => undefined)));
  }

  /** Close every kept-open connection (on quit). */
  async dispose() {
    const all = [...this.warm.values()];
    this.warm.clear();
    await Promise.all(all.map((w) => w.handle.client.close().catch(() => undefined)));
  }

  private sweepWarm() {
    const now = Date.now();
    for (const [key, w] of this.warm) {
      if (w.handle.dead || now - w.lastUsed > WARM_MS) {
        this.warm.delete(key);
        w.handle.client.close().catch(() => undefined);
      }
    }
  }

  /** An app connection for this agent: the kept-open one if it is still alive, otherwise a new one. */
  private async connection(agentId: string, name: string, config: McpServerConfig, cwd: string): Promise<{ handle: McpHandle; perTurn: boolean }> {
    const c = config as Record<string, unknown>;
    // The team tools are bound to this turn's chat, so they are made fresh (in memory, instant).
    if (c.type === 'sdk') return { handle: await this.connectMcp(name, config, cwd), perTurn: true };
    const key = `${agentId}|${name}|${JSON.stringify(c)}`;
    const existing = this.warm.get(key);
    if (existing && !existing.handle.dead) {
      existing.lastUsed = Date.now();
      return { handle: existing.handle, perTurn: false };
    }
    const handle = await this.connectMcp(name, config, cwd);
    handle.client.onclose = () => {
      handle.dead = true;
    };
    this.warm.set(key, { handle, lastUsed: Date.now() });
    return { handle, perTurn: false };
  }

  /**
   * Answer a search in one step. A small fast model with OpenAI's built-in web
   * search tool answers in about 3 seconds (measured); older search models are
   * a fallback. Retired models are skipped automatically.
   */
  private async webSearch(client: OpenAI, query: string, signal: AbortSignal): Promise<string> {
    if (!this.allModelIds.length) await this.availableModels();
    const prompt = `${query}\n\nAnswer concisely with the key facts. Include the source URLs.`;
    const usable = (m: string) => !this.retiredSearch.has(m) && (!this.allModelIds.length || this.allModelIds.includes(m));
    const withSources = (answer: string, sources: string[]) => {
      const unique = [...new Set(sources)].slice(0, 8);
      return `${answer || '(no answer)'}${unique.length ? `\n\nSources:\n${unique.join('\n')}` : ''}`;
    };
    const retired = (err: unknown) => /404|deprecated|does not exist|not found|not supported/i.test(String(err));

    for (const { model, effort } of SEARCH_TOOL_MODELS) {
      if (!usable(model)) continue;
      try {
        const res = await client.responses.create(
          { model, tools: [{ type: 'web_search' }], ...(effort ? { reasoning: { effort } } : {}), input: prompt },
          { signal },
        );
        const sources: string[] = [];
        for (const item of res.output) {
          if (item.type !== 'message') continue;
          for (const part of item.content) {
            if (part.type !== 'output_text') continue;
            for (const a of part.annotations ?? []) if (a.type === 'url_citation') sources.push(`${a.title}: ${a.url}`);
          }
        }
        return withSources(res.output_text, sources);
      } catch (err) {
        if (signal.aborted || !retired(err)) throw err;
        this.retiredSearch.add(model);
      }
    }
    for (const model of SEARCH_MODELS) {
      if (!usable(model)) continue;
      try {
        const res = await client.chat.completions.create({ model, web_search_options: {}, messages: [{ role: 'user', content: prompt }] }, { signal });
        const message = res.choices[0]?.message;
        const sources = (message?.annotations ?? []).map((a) => (a.type === 'url_citation' ? `${a.url_citation.title}: ${a.url_citation.url}` : '')).filter(Boolean);
        return withSources(message?.content ?? '', sources);
      } catch (err) {
        if (signal.aborted || !retired(err)) throw err;
        this.retiredSearch.add(model);
      }
    }
    throw new Error('Web search is not available for this OpenAI key. Use fetch_url or the browser instead.');
  }

  /** Chat models this key can use, best first (cached). */
  async availableModels(): Promise<string[]> {
    if (this.models) return this.models;
    const key = this.opts.apiKey();
    if (!key) return [];
    try {
      const client = new OpenAI({ apiKey: key });
      const ids: string[] = [];
      for await (const model of client.models.list()) ids.push(model.id);
      this.allModelIds = ids;
      const chat = ids.filter((id) => /^(gpt-[0-9]|o[0-9])/.test(id) && !/(audio|realtime|transcribe|tts|image|search|instruct|codex|live|-\d{4}-\d{2}-\d{2})/.test(id));
      const ranked = OPENAI_MODEL_PREFERENCE.filter((m) => chat.includes(m));
      this.models = [...ranked, ...chat.filter((m) => !ranked.includes(m)).sort().reverse()];
    } catch (err) {
      this.opts.log.warn('openai', 'Could not list models', String(err));
      this.models = [...OPENAI_MODEL_PREFERENCE];
    }
    return this.models;
  }

  async run(req: TurnRequest, sink: TurnSink) {
    const apiKey = this.opts.apiKey();
    if (!apiKey) {
      sink.done({ ok: false, costUsd: 0, error: 'No API key yet. Add a Claude or OpenAI key in Settings.' });
      return;
    }
    const log = this.opts.log;
    const source = `agent:${req.agentName}`;
    const client = new OpenAI({ apiKey });
    const sessionId = req.sessionId && /^[a-f0-9-]{36}$/.test(req.sessionId) ? req.sessionId : crypto.randomUUID();
    const sessionFile = path.join(this.opts.sessionsDir, `${sessionId}.json`);
    const history = repairHistory(readJson<ChatCompletionMessageParam[]>(sessionFile, []));
    sink.session(sessionId);

    const handles: McpHandle[] = [];
    const perTurn: McpHandle[] = [];
    try {
      this.sweepWarm();
      // Connect to all apps at once; kept-open connections come back instantly.
      const connected = await Promise.all(
        Object.entries(req.mcpServers).map(([name, config]) =>
          this.connection(req.agentId, name, config, req.cwd).catch((err) => {
            log.warn(source, `Could not start app "${name}"`, String(err));
            return null;
          }),
        ),
      );
      for (const c of connected) {
        if (!c) continue;
        handles.push(c.handle);
        if (c.perTurn) perTurn.push(c.handle);
      }
      // Tools per app. With the token saver on, only the team tools are sent up
      // front; the agent turns other apps on with use_app when it needs them,
      // which keeps dozens of tool definitions out of every request.
      const appTools = new Map<string, ChatCompletionTool[]>();
      await Promise.all(
        handles.map(async (handle) => {
          if (!handle.listed) {
            const { tools } = await handle.client.listTools();
            handle.listed = tools.map((tool) => {
              const fullName = `mcp__${handle.server}__${tool.name}`.slice(0, 64);
              handle.tools.set(fullName, tool.name);
              const { $schema: _s, ...schema } = (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>;
              return { type: 'function' as const, function: { name: fullName, description: (tool.description ?? '').slice(0, 1000), parameters: schema } };
            });
          }
          appTools.set(handle.server, handle.listed);
        }),
      );
      const lazyApps = [...appTools.keys()].filter((app) => req.saver && app !== 'frog');
      const enabled = new Set<string>([...appTools.keys()].filter((app) => !lazyApps.includes(app)));
      // Apps already used earlier in this conversation stay on.
      for (const m of history) {
        if (m.role !== 'assistant') continue;
        for (const c of m.tool_calls ?? []) {
          const name = c.type === 'function' ? c.function.name : '';
          const app = [...appTools.keys()].find((a) => name.startsWith(`mcp__${a}__`));
          if (app) enabled.add(app);
        }
      }
      const useApp: ChatCompletionTool | null = lazyApps.length
        ? fn(
            'use_app',
            `Turn on the tools of a connected app before using it. Apps: ${lazyApps.map((a) => `${a} (${appTools.get(a)!.length} tools)`).join(', ')}.`,
            { app: { type: 'string', enum: lazyApps } },
            ['app'],
          )
        : null;
      const currentTools = () => [
        ...LOCAL_TOOLS.map((t) => t.tool),
        ...(useApp ? [useApp] : []),
        ...[...enabled].flatMap((app) => appTools.get(app) ?? []),
      ];
      log.info(source, 'Engine ready (OpenAI)', {
        model: req.model,
        apps: handles.map((h) => `${h.server}:${h.tools.size}${enabled.has(h.server) ? '' : ' (on demand)'}`).join(', '),
      });
      let tokens = 0;
      const system: ChatCompletionMessageParam = { role: 'system', content: `${baseSystemPrompt(req)}\n\n${req.systemPromptAppend}` };
      history.push({ role: 'user', content: req.prompt });

      for (let step = 0; step < MAX_STEPS; step++) {
        if (req.abort.signal.aborted) throw new Error('Stopped');
        // No reasoning_effort here: OpenAI rejects it together with tools on
        // newer models in chat completions (400). The model's default is used.
        const stream = await client.chat.completions.create(
          {
            model: req.model,
            messages: [system, ...(req.saver ? trimForTokens(history) : history)],
            tools: currentTools(),
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: req.abort.signal },
        );
        let text = '';
        const calls: { id: string; name: string; args: string }[] = [];
        for await (const chunk of stream) {
          if (chunk.usage) tokens += (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            text += delta.content;
            sink.textDelta(delta.content);
          }
          for (const call of delta.tool_calls ?? []) {
            const slot = (calls[call.index] ??= { id: '', name: '', args: '' });
            if (call.id) slot.id = call.id;
            if (call.function?.name) slot.name += call.function.name;
            if (call.function?.arguments) slot.args += call.function.arguments;
          }
        }
        if (text.trim()) sink.textDone(text);
        // A streamed index can skip numbers; drop the holes and nameless calls.
        for (let k = calls.length - 1; k >= 0; k--) if (!calls[k] || !calls[k].id || !calls[k].name) calls.splice(k, 1);
        history.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } })) } : {}),
        });
        if (calls.length === 0) {
          this.save(sessionFile, history);
          sink.done({ ok: true, costUsd: 0, tokens });
          return;
        }
        // Steps the model asked for together are independent, so they run at the same time.
        const outputs = await Promise.all(
          calls.map(async (call) => {
            if (call.name !== 'use_app') return this.runTool(call, req, sink, handles, client);
            let app = '';
            try {
              app = String(JSON.parse(call.args || '{}').app ?? '');
            } catch {
              // reported below as an unknown app
            }
            const known = appTools.has(app);
            if (known) enabled.add(app);
            sink.tool(call.id, `Opened app: ${app}`, {});
            const note = known
              ? `${app} is on. Tools: ${appTools.get(app)!.map((t) => (t.type === 'function' ? t.function.name : '')).join(', ')}`
              : `Unknown app "${app}"`;
            sink.toolResult(call.id, note, !known);
            return note;
          }),
        );
        calls.forEach((call, i) => history.push({ role: 'tool', tool_call_id: call.id, content: outputs[i].slice(0, TOOL_OUTPUT_LIMIT) }));
        this.save(sessionFile, history);
      }
      this.save(sessionFile, history);
      sink.done({ ok: false, costUsd: 0, error: `Stopped after ${MAX_STEPS} steps. Ask me to continue if there is more to do.` });
    } catch (err) {
      this.save(sessionFile, history);
      const aborted = req.abort.signal.aborted;
      sink.done({ ok: false, costUsd: 0, error: aborted ? 'Stopped' : friendlyError(err) });
    } finally {
      // Kept-open connections stay up for the next message; only per-turn ones close.
      await Promise.all(perTurn.map((h) => h.client.close().catch(() => undefined)));
    }
  }

  private save(file: string, history: ChatCompletionMessageParam[]) {
    repairHistory(history);
    let trimmed = history;
    if (history.length > HISTORY_LIMIT) {
      // Cut at a user message so tool results never lose their call. If one
      // turn is longer than the limit, keep that whole turn.
      let start = history.length - HISTORY_LIMIT;
      while (start < history.length && history[start].role !== 'user') start++;
      if (start >= history.length) {
        start = history.length - HISTORY_LIMIT;
        while (start > 0 && history[start].role !== 'user') start--;
      }
      trimmed = history.slice(start);
    }
    try {
      writeFileAtomic(file, JSON.stringify(trimmed));
    } catch (err) {
      this.opts.log.error('openai', 'Could not save the conversation', String(err));
    }
  }

  private async runTool(call: { id: string; name: string; args: string }, req: TurnRequest, sink: TurnSink, handles: McpHandle[], client: OpenAI) {
    let input: Record<string, unknown>;
    try {
      const parsed = call.args ? JSON.parse(call.args) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      input = parsed;
    } catch {
      sink.toolResult(call.id, 'Invalid tool arguments', true);
      return 'Error: the tool arguments must be a JSON object. Try again.';
    }
    const local = LOCAL_TOOLS.find((t) => t.tool.type === 'function' && t.tool.function.name === call.name);
    const handle = handles.find((h) => h.tools.has(call.name));
    const permissionName = local ? local.permission : call.name;
    const permissionInput = local ? toPermissionInput(call.name, input, req.cwd) : input;

    sink.tool(call.id, permissionName === call.name ? call.name : `${permissionName}`, permissionInput);
    const verdict = await req.canUseTool(permissionName, permissionInput, { signal: req.abort.signal } as Parameters<TurnRequest['canUseTool']>[2]);
    if (!verdict || verdict.behavior === 'deny') {
      const message = verdict && 'message' in verdict ? verdict.message : 'Not allowed.';
      sink.toolResult(call.id, message, true);
      if (verdict && 'interrupt' in verdict && verdict.interrupt) req.abort.abort();
      return `Not allowed: ${message}`;
    }

    try {
      let text: string;
      let image: string | undefined;
      if (call.name === 'web_search') text = await this.webSearch(client, String(input.query ?? ''), req.abort.signal);
      else if (local) text = await runLocalTool(call.name, input, req);
      else if (handle) ({ text, image } = await callMcp(handle, handle.tools.get(call.name)!, input));
      else text = `Unknown tool ${call.name}`;
      sink.toolResult(call.id, text, false, image);
      return text || '(no output)';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sink.toolResult(call.id, message, true);
      return `Error: ${message}`;
    }
  }

  private async connectMcp(name: string, config: McpServerConfig, cwd: string): Promise<McpHandle> {
    const client = new Client({ name: 'frog-bot', version: APP_VERSION });
    const c = config as Record<string, any>;
    if (c.type === 'sdk') {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await c.instance.connect(serverSide);
      await client.connect(clientSide);
    } else if (c.type === 'http') {
      await client.connect(new StreamableHTTPClientTransport(new URL(c.url), { requestInit: { headers: c.headers ?? {} } }));
    } else if (c.type === 'sse') {
      await client.connect(new SSEClientTransport(new URL(c.url), { requestInit: { headers: c.headers ?? {} } }));
    } else {
      await client.connect(new StdioClientTransport({ command: c.command, args: c.args ?? [], env: { ...getDefaultEnvironment(), ...(c.env ?? {}) }, cwd, stderr: 'ignore' }));
    }
    return { client, server: name, tools: new Map() };
  }
}

/**
 * Token saver: tool output from earlier requests has already been read, so
 * only a short head of it is sent again. The latest round stays complete.
 */
export function trimForTokens(history: ChatCompletionMessageParam[], keep = 600): ChatCompletionMessageParam[] {
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  return history.map((m, i) => {
    if (i >= lastUser || m.role !== 'tool' || typeof m.content !== 'string' || m.content.length <= keep) return m;
    return { ...m, content: `${m.content.slice(0, keep)}\n…(older output trimmed to save tokens)` };
  });
}

/**
 * Every assistant tool call must be followed by its tool result, or OpenAI
 * rejects the whole conversation. If a turn was cut short, fill in the gaps.
 */
export function repairHistory(history: ChatCompletionMessageParam[]) {
  for (let i = 0; i < history.length; i++) {
    const message = history[i];
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
    const answered = new Set<string>();
    let j = i + 1;
    while (j < history.length && history[j].role === 'tool') {
      answered.add((history[j] as { tool_call_id: string }).tool_call_id);
      j++;
    }
    const missing = message.tool_calls.filter((c) => !answered.has(c.id));
    history.splice(j, 0, ...missing.map((c) => ({ role: 'tool' as const, tool_call_id: c.id, content: 'Not run: the task was interrupted.' })));
  }
  return history;
}

function baseSystemPrompt(req: TurnRequest) {
  return `You are an autonomous AI agent working on the user's own computer through tools.
Today is ${new Date().toDateString()}. OS: ${os.type()} ${os.release()}. Your working folder: ${req.cwd}. Shared folder: ${req.additionalDirectories.join(', ')}.
Use tools to actually do the work instead of describing what you would do. Read before you edit. Prefer your own folder for working files.
Work fast: use web_search first for anything you need to find (one step gives an answer with sources), fetch_url for a known page or API, and the browser only when a site has no other way in. When several steps do not depend on each other, request them together in one go; they run at the same time.
If an action is refused, do not retry it another way; explain and ask. Keep answers short and clear, and say what you did.`;
}

function toPermissionInput(name: string, input: Record<string, unknown>, cwd: string): Record<string, unknown> {
  const abs = (p: unknown) => (typeof p === 'string' && p ? (path.isAbsolute(p) ? p : path.join(cwd, p)) : cwd);
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return { ...input, file_path: abs(input.path) };
    case 'list_files':
    case 'search_files':
      return { ...input, path: abs(input.path) };
    case 'run_command':
      return { command: input.command };
    case 'fetch_url':
      return { url: input.url };
    default:
      return input;
  }
}

async function runLocalTool(name: string, input: Record<string, unknown>, req: TurnRequest): Promise<string> {
  const resolve = (p: unknown) => (typeof p === 'string' && p ? (path.isAbsolute(p) ? p : path.join(req.cwd, p)) : req.cwd);
  switch (name) {
    case 'read_file': {
      const file = resolve(input.path);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const start = Math.max(1, Number(input.offset) || 1);
      const end = input.limit ? start + Number(input.limit) - 1 : lines.length;
      return lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n');
    }
    case 'write_file': {
      const file = resolve(input.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(input.content ?? ''));
      return `Wrote ${file}`;
    }
    case 'edit_file': {
      const file = resolve(input.path);
      const text = fs.readFileSync(file, 'utf8');
      const oldText = String(input.old_text ?? '');
      const count = oldText ? text.split(oldText).length - 1 : 0;
      if (count !== 1) return `Error: old_text was found ${count} times; it must appear exactly once.`;
      fs.writeFileSync(file, text.replace(oldText, String(input.new_text ?? '')));
      return `Edited ${file}`;
    }
    case 'list_files': {
      const dir = resolve(input.path);
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.name !== 'browser-profile')
        .map((d) => `${d.isDirectory() ? '[dir] ' : ''}${d.name}`)
        .join('\n') || '(empty)';
    }
    case 'search_files':
      return searchFiles(resolve(input.path), String(input.text ?? ''));
    case 'run_command':
      return runCommand(String(input.command ?? ''), req.cwd, Number(input.timeout_seconds) || 120, req.abort.signal);
    case 'fetch_url': {
      const res = await fetch(String(input.url), { signal: AbortSignal.any([req.abort.signal, AbortSignal.timeout(30_000)]) });
      const body = await res.text();
      const text = /html/i.test(res.headers.get('content-type') ?? '') ? htmlToText(body) : body;
      return `HTTP ${res.status}\n${text}`;
    }
    default:
      return `Unknown tool ${name}`;
  }
}

function searchFiles(dir: string, needle: string) {
  const hits: string[] = [];
  const lower = needle.toLowerCase();
  const walk = (d: string, depth: number) => {
    if (depth > 6 || hits.length >= 200) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'browser-profile') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (fs.statSync(full).size < 2_000_000) {
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (hits.length < 200 && line.toLowerCase().includes(lower)) hits.push(`${full}:${i + 1}: ${line.slice(0, 200)}`);
        });
      }
    }
  };
  walk(dir, 0);
  return hits.join('\n') || 'No matches.';
}

/**
 * Run a shell command. Finishes when the command exits (not when every
 * process it started lets go of the output), and Stop or the timeout kill the
 * whole process tree, so a command that starts a server can never hang an agent.
 */
function runCommand(command: string, cwd: string, timeoutSeconds: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, windowsHide: true })
      : spawn('bash', ['-lc', command], { cwd, detached: true });
    let out = '';
    let settled = false;
    const add = (d: Buffer) => {
      if (out.length < TOOL_OUTPUT_LIMIT) out += d.toString();
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const killTree = () => {
      if (!child.pid) return;
      try {
        if (isWin) spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill();
      }
    };
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(text);
    };
    const onAbort = () => {
      killTree();
      finish(`${out.trim()}\n(stopped)`);
    };
    const timer = setTimeout(() => {
      killTree();
      finish(`${out.trim()}\n(timed out after ${timeoutSeconds}s and was stopped)`);
    }, Math.min(timeoutSeconds, 600) * 1000);
    signal.addEventListener('abort', onAbort, { once: true });
    // Give the pipes a moment to drain after exit, then finish regardless.
    child.on('exit', (code) => setTimeout(() => finish(`${out.trim()}\n(exit code ${code})`), 300));
    child.on('error', (err) => finish(`Error: ${err.message}`));
  });
}

async function callMcp(handle: McpHandle, tool: string, input: Record<string, unknown>) {
  const result = await handle.client.callTool({ name: tool, arguments: input });
  let text = '';
  let image: string | undefined;
  for (const block of (result.content as Array<Record<string, any>>) ?? []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'image') image = `data:${block.mimeType};base64,${block.data}`;
  }
  if (result.isError) throw new Error(text || 'The app returned an error');
  return { text, image };
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TOOL_OUTPUT_LIMIT);
}

function friendlyError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|incorrect api key|invalid_api_key/i.test(message)) return 'OpenAI rejected the API key. Check it in Settings.';
  if (/429|quota|rate limit/i.test(message)) return 'OpenAI says the account is out of quota or rate limited. Check billing at platform.openai.com.';
  if (/model.*(does not exist|not found)/i.test(message)) return `That OpenAI model is not available for this key: ${message}`;
  return message;
}
