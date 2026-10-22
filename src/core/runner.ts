import { query, type CanUseTool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from './logger';

export interface TurnRequest {
  agentId: string;
  agentName: string;
  model: string;
  cwd: string;
  additionalDirectories: string[];
  prompt: string;
  sessionId?: string;
  systemPromptAppend: string;
  mcpServers: Record<string, McpServerConfig>;
  canUseTool: CanUseTool;
  abort: AbortController;
}

/** What a turn reports back while it runs. */
export interface TurnSink {
  textDelta(text: string): void;
  textDone(text: string): void;
  tool(id: string, name: string, input: Record<string, unknown>): void;
  toolResult(id: string, text: string, isError: boolean, image?: string): void;
  session(sessionId: string): void;
  done(result: { ok: boolean; costUsd: number; error?: string }): void;
}

export interface TurnRunner {
  run(request: TurnRequest, sink: TurnSink): Promise<void>;
}

/** Tools from Claude Code that make no sense inside Frog Bot (it has its own versions). */
const DISALLOWED_TOOLS = [
  'Artifact', 'AskUserQuestion', 'ClaudeDesign', 'CronCreate', 'CronDelete', 'CronList', 'EndConversation',
  'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree', 'ExitWorktree', 'ListAgents', 'Monitor',
  'OfferChromeSetup', 'Projects', 'propose_skills', 'ProposeGoal', 'PushNotification', 'ReadNotifications',
  'RemoteTrigger', 'ReportFindings', 'ScheduleWakeup', 'SendFeedback', 'SendMessage', 'SendUserFile',
  'SendUserMessage', 'ShareOnboardingGuide', 'ShowOnboardingRolePicker', 'SubagentHandback', 'Workflow',
];

export interface ClaudeRunnerOptions {
  apiKey: () => string | undefined;
  /** Private config dir for the engine, so it never touches the user's own Claude Code setup. */
  engineDir: string;
  /** Path to the bundled `claude` binary when running from a packaged app. */
  executablePath?: () => string | undefined;
  log: Logger;
}

/** Environment for the engine: the user's env minus anything Claude-related, plus our key. */
export function engineEnv(apiKey: string, engineDir: string, base: NodeJS.ProcessEnv = process.env) {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/.test(k)) continue;
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    env[k] = v;
  }
  env.ANTHROPIC_API_KEY = apiKey;
  env.CLAUDE_CONFIG_DIR = engineDir;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'frog-bot/0.1.0';
  return env;
}

function toolResultText(content: unknown): { text: string; image?: string } {
  if (typeof content === 'string') return { text: content };
  if (!Array.isArray(content)) return { text: '' };
  let text = '';
  let image: string | undefined;
  for (const block of content as Array<Record<string, any>>) {
    if (block?.type === 'text') text += block.text;
    if (block?.type === 'image' && block.source?.type === 'base64') {
      image = `data:${block.source.media_type};base64,${block.source.data}`;
    }
  }
  return { text, image };
}

/** Runs agent turns on the Claude Agent SDK (the engine behind Claude Code). */
export class ClaudeRunner implements TurnRunner {
  constructor(private opts: ClaudeRunnerOptions) {}

  async run(req: TurnRequest, sink: TurnSink) {
    const apiKey = this.opts.apiKey();
    if (!apiKey) {
      sink.done({ ok: false, costUsd: 0, error: 'No API key yet. Add a Claude or OpenAI key in Settings.' });
      return;
    }
    const log = this.opts.log;
    const source = `agent:${req.agentName}`;
    let streamed = '';
    let finished = false;

    const stream = query({
      prompt: req.prompt,
      options: {
        cwd: req.cwd,
        additionalDirectories: req.additionalDirectories,
        model: req.model,
        effort: 'high',
        resume: req.sessionId,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: req.systemPromptAppend },
        mcpServers: req.mcpServers,
        canUseTool: req.canUseTool,
        permissionMode: 'default',
        settingSources: [],
        includePartialMessages: true,
        disallowedTools: DISALLOWED_TOOLS,
        abortController: req.abort,
        env: engineEnv(apiKey, this.opts.engineDir),
        pathToClaudeCodeExecutable: this.opts.executablePath?.(),
        stderr: (data: string) => log.debug(source, 'engine stderr', data),
      },
    });

    try {
      for await (const message of stream) {
        switch (message.type) {
          case 'system':
            if (message.subtype === 'init') {
              sink.session(message.session_id);
              log.info(source, 'Engine ready', {
                model: message.model,
                mcp: message.mcp_servers.map((s) => `${s.name}:${s.status}`).join(', '),
              });
            }
            break;
          case 'stream_event': {
            if (message.parent_tool_use_id) break;
            const event = message.event as { type: string; delta?: { type: string; text?: string } };
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              streamed += event.delta.text;
              sink.textDelta(event.delta.text);
            }
            break;
          }
          case 'assistant': {
            if (message.parent_tool_use_id) {
              for (const block of message.message.content) {
                if (block.type === 'tool_use') sink.tool(block.id, `subagent ▸ ${block.name}`, block.input as Record<string, unknown>);
              }
              break;
            }
            for (const block of message.message.content) {
              if (block.type === 'text' && block.text.trim()) {
                sink.textDone(block.text);
                streamed = '';
              } else if (block.type === 'tool_use') {
                sink.tool(block.id, block.name, block.input as Record<string, unknown>);
              }
            }
            if (message.error) log.warn(source, 'Assistant message error', message.error);
            break;
          }
          case 'user': {
            const content = message.message.content;
            if (!Array.isArray(content)) break;
            for (const block of content as Array<Record<string, any>>) {
              if (block.type !== 'tool_result') continue;
              const { text, image } = toolResultText(block.content);
              sink.toolResult(block.tool_use_id, text, Boolean(block.is_error), image);
            }
            break;
          }
          case 'result': {
            finished = true;
            if (streamed.trim()) sink.textDone(streamed);
            if (message.subtype === 'success' && !message.is_error) {
              sink.done({ ok: true, costUsd: message.total_cost_usd });
            } else {
              const error = message.subtype === 'success' ? message.result : message.errors.join('\n') || message.subtype;
              sink.done({ ok: false, costUsd: message.total_cost_usd ?? 0, error });
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (err) {
      if (!finished) {
        const aborted = req.abort.signal.aborted;
        sink.done({ ok: false, costUsd: 0, error: aborted ? 'Stopped' : err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (!finished) sink.done({ ok: false, costUsd: 0, error: req.abort.signal.aborted ? 'Stopped' : 'The engine ended without a result' });
  }
}
