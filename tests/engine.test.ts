import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import config from '../config/frogbot.config.json';
import { FrogEngine, type AppConfig, type EngineHost } from '../src/core/engine';
import { FrogPaths } from '../src/core/paths';
import { MemorySecretBox } from '../src/core/secrets';
import type { TurnRequest, TurnRunner, TurnSink } from '../src/core/runner';
import type { EngineEvent, Message } from '../src/shared/types';

type Script = (req: TurnRequest, sink: TurnSink, tools: (name: string, args: Record<string, unknown>) => Promise<string>) => Promise<void>;

/** A fake brain: each agent follows a script and can call the real team tools. */
class ScriptedRunner implements TurnRunner {
  scripts = new Map<string, Script>();
  prompts: { agent: string; prompt: string; model: string; resume?: string }[] = [];

  async run(req: TurnRequest, sink: TurnSink) {
    this.prompts.push({ agent: req.agentName, prompt: req.prompt, model: req.model, resume: req.sessionId });
    sink.session(`session-${req.agentName}`);
    const frog = req.mcpServers.frog as unknown as { instance: { connect(t: unknown): Promise<void> } };
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await frog.instance.connect(serverSide);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientSide);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      return (result.content as { text: string }[]).map((c) => c.text).join('');
    };
    try {
      const script = this.scripts.get(req.agentName) ?? (async (_r, s) => s.textDone(`ok from ${req.agentName}`));
      await script(req, sink, call);
      sink.done({ ok: true, costUsd: 0.001 });
    } finally {
      await client.close();
    }
  }
}

let dir: string;
let engine: FrogEngine;
let runner: ScriptedRunner;
let events: EngineEvent[];
const notifications: string[] = [];

const host: EngineHost = {
  platform: 'Test OS',
  openExternal: async () => undefined,
  openPath: async () => undefined,
  notify: (title) => notifications.push(title),
  nodeRuntime: () => ({ command: process.execPath, env: {} }),
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-engine-'));
  runner = new ScriptedRunner();
  // No built-in integrations here, so tests never reach the network.
  engine = new FrogEngine({
    paths: new FrogPaths(dir),
    config: { ...(config as AppConfig), integrations: [] },
    secrets: new MemorySecretBox(),
    host,
    runner,
    envApiKey: 'sk-ant-test-key-for-unit-tests-only',
  });
  events = [];
  engine.onEvent((e) => events.push(e));
  await engine.start();
});

afterEach(() => {
  engine.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const frogThread = () => engine.snapshot().conversations.find((c) => c.kind === 'direct' && c.title === 'Frog')!;
const texts = (id: string) => engine.messages(id).map((m: Message) => `${m.author.kind}:${m.kind}:${m.text}`);

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('engine', () => {
  it('starts with the default agent, its folder and memory', () => {
    const agents = engine.snapshot().agents;
    expect(agents.map((a) => a.name)).toEqual(['Frog']);
    expect(fs.existsSync(path.join(dir, 'agents', 'frog', 'memory.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'shared', 'team-memory.md'))).toBe(true);
  });

  it('runs a turn: streams text, remembers the session, logs it', async () => {
    runner.scripts.set('Frog', async (_req, sink) => {
      sink.textDelta('Hel');
      sink.textDelta('lo!');
      sink.textDone('Hello!');
    });
    await engine.sendMessage(frogThread().id, 'hi');
    await engine.idle();
    expect(texts(frogThread().id)).toEqual(['user:text:hi', 'agent:text:Hello!']);
    expect(engine.messages(frogThread().id)[1].streaming).toBe(false);
    expect(frogThread().sessions[frogThread().memberIds[0]]).toBe('session-Frog');
    expect(engine.logs().some((l) => l.source === 'agent:Frog' && l.message.startsWith('Turn finished'))).toBe(true);

    await engine.sendMessage(frogThread().id, 'again');
    await engine.idle();
    expect(runner.prompts[1].resume).toBe('session-Frog');
  });

  it('agents message each other and the reply lands in the teammate\'s thread', async () => {
    const { agent: docs, conversation: docsThread } = engine.createAgent({ name: 'Docs Guy', label: 'Writes drafts' });
    runner.scripts.set('Frog', async (_req, sink, tool) => {
      const result = await tool('message_agent', { to: 'docs guy', message: 'Draft a post about frogs' });
      sink.textDone(`Asked Docs Guy. (${result})`);
    });
    runner.scripts.set('Docs Guy', async (req, sink) => sink.textDone(`Draft ready for: ${req.prompt.split('\n')[1]}`));

    await engine.sendMessage(frogThread().id, 'Get a draft written');
    await engine.idle();

    expect(texts(frogThread().id)).toContain('agent:relay:Draft a post about frogs');
    expect(texts(docsThread.id)).toEqual(['agent:relay:Draft a post about frogs', 'agent:text:Draft ready for: Draft a post about frogs']);
    expect(runner.prompts.find((p) => p.agent === 'Docs Guy')!.prompt).toContain('[Message from your teammate Frog');
    expect(engine.snapshot().agents.find((a) => a.id === docs.id)).toBeTruthy();
  });

  it('stops endless hand-offs between agents', async () => {
    engine.createAgent({ name: 'Ping' });
    engine.createAgent({ name: 'Pong' });
    runner.scripts.set('Ping', async (_r, sink, tool) => sink.textDone(await tool('message_agent', { to: 'Pong', message: 'your turn' })));
    runner.scripts.set('Pong', async (_r, sink, tool) => sink.textDone(await tool('message_agent', { to: 'Ping', message: 'your turn' })));
    const ping = engine.directConversation(engine.snapshot().agents.find((a) => a.name === 'Ping')!.id)!;
    await engine.sendMessage(ping.id, 'start');
    await engine.idle();
    const turns = runner.prompts.filter((p) => p.agent === 'Ping' || p.agent === 'Pong').length;
    expect(turns).toBeLessThanOrEqual(8);
    expect(engine.logs().some((l) => l.message.includes('too many hand-offs'))).toBe(true);
  });

  it('asks the user a question and waits for the answer', async () => {
    let answer = '';
    runner.scripts.set('Frog', async (_r, sink, tool) => {
      answer = await tool('ask_user', { question: 'Update the voice rules?', options: ['Yes', 'No'] });
      sink.textDone('Thanks');
    });
    await engine.sendMessage(frogThread().id, 'go');
    await until(() => engine.messages(frogThread().id).some((m) => m.kind === 'question'));
    const question = engine.messages(frogThread().id).find((m) => m.kind === 'question')!;
    expect(engine.snapshot().runtimes[frogThread().memberIds[0]].status).toBe('waiting');
    expect(notifications).toContain('Frog has a question');
    await engine.answerQuestion(question.id, 'Yes');
    await engine.idle();
    expect(answer).toBe('The user answered: Yes');
    expect(engine.messages(frogThread().id).find((m) => m.id === question.id)!.question!.answer).toBe('Yes');
  });

  it('asks for approval before risky tools, and remembers "always allow"', async () => {
    const decisions: string[] = [];
    runner.scripts.set('Frog', async (req, sink) => {
      const r = await req.canUseTool('mcp__ros__create_post_action', { title: 'x' }, { signal: req.abort.signal } as never);
      decisions.push(r!.behavior);
      sink.textDone('done');
    });
    await engine.sendMessage(frogThread().id, 'post it');
    await until(() => engine.messages(frogThread().id).some((m) => m.kind === 'approval'));
    const approval = engine.messages(frogThread().id).find((m) => m.kind === 'approval')!;
    await engine.decideApproval(approval.id, 'always');
    await engine.idle();
    expect(decisions).toEqual(['allow']);
    expect(engine.snapshot().agents[0].alwaysAllow).toContain('mcp__ros__create_post_action');

    await engine.sendMessage(frogThread().id, 'post another');
    await engine.idle();
    expect(decisions).toEqual(['allow', 'allow']);
    expect(engine.messages(frogThread().id).filter((m) => m.kind === 'approval')).toHaveLength(1);
  });

  it('denies when the user says no, and Stop cancels a waiting approval', async () => {
    const decisions: string[] = [];
    runner.scripts.set('Frog', async (req, sink) => {
      const r = await req.canUseTool('Bash', { command: 'echo hi' }, { signal: req.abort.signal } as never);
      decisions.push(r!.behavior);
      sink.textDone('after');
    });
    await engine.sendMessage(frogThread().id, 'run something');
    await until(() => engine.messages(frogThread().id).some((m) => m.kind === 'approval'));
    await engine.decideApproval(engine.messages(frogThread().id).find((m) => m.kind === 'approval')!.id, 'deny');
    await engine.idle();
    expect(decisions).toEqual(['deny']);

    await engine.sendMessage(frogThread().id, 'run again');
    await until(() => engine.messages(frogThread().id).filter((m) => m.kind === 'approval').length === 2);
    await engine.stopConversation(frogThread().id);
    await engine.idle();
    expect(decisions).toEqual(['deny', 'deny']);
  });

  it('a new agent can be requested by an agent and approved by the user', async () => {
    runner.scripts.set('Frog', async (_r, sink, tool) => {
      sink.textDone(await tool('request_new_agent', { name: 'Researcher', label: 'Finds facts', instructions: 'Research.', reason: 'Need facts' }));
    });
    await engine.sendMessage(frogThread().id, 'we need research');
    await until(() => engine.messages(frogThread().id).some((m) => m.kind === 'agent-request'));
    await engine.decideAgentRequest(engine.messages(frogThread().id).find((m) => m.kind === 'agent-request')!.id, 'approved');
    await engine.idle();
    expect(engine.snapshot().agents.map((a) => a.name)).toContain('Researcher');
    expect(texts(frogThread().id).at(-1)).toContain('Researcher is on the team');
  });

  it('routes group messages to @mentioned agents only, or to everyone', async () => {
    engine.createAgent({ name: 'Docs Guy' });
    const ids = engine.snapshot().agents.map((a) => a.id);
    const group = engine.createGroup('Sam Bots', ids);
    runner.scripts.set('Frog', async (_r, sink) => sink.textDone('(no reply)'));

    await engine.sendMessage(group.id, '@Docs Guy write the draft');
    await engine.idle();
    expect(runner.prompts.map((p) => p.agent)).toEqual(['Docs Guy']);
    expect(runner.prompts[0].prompt).toContain('User: @Docs Guy write the draft');

    await engine.sendMessage(group.id, 'everyone check in');
    await engine.idle();
    expect(runner.prompts.map((p) => p.agent).sort()).toEqual(['Docs Guy', 'Docs Guy', 'Frog']);
    // "(no reply)" is not shown.
    expect(texts(group.id).some((t) => t.includes('no reply'))).toBe(false);
  });

  it('remembers things in the agent and team memory files', async () => {
    runner.scripts.set('Frog', async (_r, sink, tool) => {
      await tool('remember', { note: 'User likes short replies', scope: 'self' });
      await tool('remember', { note: 'Client is DeepInfra', scope: 'team' });
      sink.textDone('noted');
    });
    await engine.sendMessage(frogThread().id, 'remember this');
    await engine.idle();
    expect(fs.readFileSync(path.join(dir, 'agents', 'frog', 'memory.md'), 'utf8')).toContain('User likes short replies');
    expect(fs.readFileSync(path.join(dir, 'shared', 'team-memory.md'), 'utf8')).toContain('(Frog) Client is DeepInfra');

    runner.scripts.set('Frog', async (req, sink) => sink.textDone(req.systemPromptAppend.includes('User likes short replies') ? 'I remember' : 'forgot'));
    await engine.sendMessage(frogThread().id, 'what do you know?');
    await engine.idle();
    expect(texts(frogThread().id).at(-1)).toBe('agent:text:I remember');
  });

  it('runs scheduled tasks when they are due', async () => {
    runner.scripts.set('Frog', async (req, sink, tool) => {
      if (req.prompt.startsWith('[Scheduled')) return sink.textDone('checked slack');
      sink.textDone(await tool('schedule_task', { prompt: 'check slack', every_minutes: 30 }));
    });
    await engine.sendMessage(frogThread().id, 'check slack every 30 min');
    await engine.idle();
    expect(engine.snapshot().tasks).toHaveLength(1);
    engine.runDueTasks(Date.now() + 31 * 60_000);
    await engine.idle();
    expect(texts(frogThread().id).at(-1)).toBe('agent:text:checked slack');
    engine.deleteTask(engine.snapshot().tasks[0].id);
    expect(engine.snapshot().tasks).toHaveLength(0);
  });

  it('shows a clear error in the chat when a turn fails', async () => {
    runner.scripts.set('Frog', async () => {
      throw new Error('boom');
    });
    await engine.sendMessage(frogThread().id, 'fail');
    await engine.idle();
    expect(engine.logs().some((l) => l.level === 'error')).toBe(true);
    expect(texts(frogThread().id).at(-1)).toBe('system:error:Frog hit a problem: boom');
    expect(engine.snapshot().runtimes[frogThread().memberIds[0]].status).toBe('error');
  });

  it('persists agents, chats and messages across restarts', async () => {
    await engine.sendMessage(frogThread().id, 'hello');
    await engine.idle();
    engine.stop();
    const again = new FrogEngine({ paths: new FrogPaths(dir), config: { ...(config as AppConfig), integrations: [] }, secrets: new MemorySecretBox(), host, runner });
    expect(again.snapshot().agents.map((a) => a.name)).toEqual(['Frog']);
    const thread = again.snapshot().conversations.find((c) => c.title === 'Frog')!;
    expect(again.messages(thread.id).map((m) => m.text)).toEqual(['hello', 'ok from Frog']);
  });

  it('removes agents but keeps their files', async () => {
    const { agent } = engine.createAgent({ name: 'Temp' });
    engine.deleteAgent(agent.id);
    expect(engine.snapshot().agents.map((a) => a.name)).toEqual(['Frog']);
    expect(fs.existsSync(path.join(dir, 'agents', 'temp'))).toBe(true);
  });

  it('rejects duplicate names and empty names', () => {
    expect(() => engine.createAgent({ name: 'frog' })).toThrow(/already/);
    expect(() => engine.createAgent({ name: '  ' })).toThrow(/name/);
  });

  it('picks the brain from the keys it has', async () => {
    expect(engine.settings().provider).toBe('anthropic');
    const openaiOnly = new FrogEngine({ paths: new FrogPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'frog-oa-'))), config: { ...(config as AppConfig), integrations: [] }, secrets: new MemorySecretBox(), host, runner, envOpenAiKey: 'sk-proj-test' });
    expect(openaiOnly.settings().provider).toBe('openai');
    expect(openaiOnly.settings().hasApiKey).toBe(true);
    const none = new FrogEngine({ paths: new FrogPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'frog-none-'))), config: { ...(config as AppConfig), integrations: [] }, secrets: new MemorySecretBox(), host, runner });
    expect(none.settings().provider).toBeNull();
    await expect(none.setApiKey('nope')).rejects.toThrow(/does not look like/);
  });

  it('keeps file listing inside the agent folder', () => {
    const frog = engine.snapshot().agents[0];
    expect(engine.listFiles(frog.id).map((f) => f.name)).toContain('memory.md');
    expect(() => engine.listFiles(frog.id, '../../')).toThrow(/Outside/);
  });
});

describe('modes, waiting and group hand-offs', () => {
  it('keeps a hand-off inside the group when both agents are in it', async () => {
    const { conversation: dogThread } = engine.createAgent({ name: 'Dog' });
    const group = engine.createGroup('Team', engine.snapshot().agents.map((a) => a.id));
    runner.scripts.set('Frog', async (_r, sink, tool) => sink.textDone(await tool('message_agent', { to: 'Dog', message: 'please transcribe 2:00-3:00' })));
    runner.scripts.set('Dog', async (req, sink) => sink.textDone(req.prompt.includes('group chat "Team"') ? 'done, in the group' : 'done elsewhere'));
    await engine.sendMessage(group.id, '@Frog get Dog to do it');
    await engine.idle();
    expect(texts(group.id)).toContain('agent:relay:please transcribe 2:00-3:00');
    expect(texts(group.id)).toContain('agent:text:done, in the group');
    expect(engine.messages(dogThread.id)).toHaveLength(0);
  });

  it('reports what an agent is waiting on, wherever the card is', async () => {
    runner.scripts.set('Frog', async (req, sink) => {
      await req.canUseTool('Bash', { command: 'yt-dlp --version' }, { signal: req.abort.signal } as never);
      sink.textDone('ok');
    });
    await engine.sendMessage(frogThread().id, 'check yt-dlp');
    await until(() => Boolean(engine.snapshot().runtimes[frogThread().memberIds[0]].waitingOn));
    const waiting = engine.snapshot().runtimes[frogThread().memberIds[0]].waitingOn!;
    expect(waiting.kind).toBe('approval');
    expect(waiting.conversationId).toBe(frogThread().id);
    expect(waiting.text).toContain('yt-dlp');
    await engine.decideApproval(waiting.messageId, 'allow');
    await engine.idle();
    expect(engine.snapshot().runtimes[frogThread().memberIds[0]].waitingOn).toBeUndefined();
    expect(engine.snapshot().runtimes[frogThread().memberIds[0]].status).toBe('idle');
  });

  it('plan mode looks but never changes anything, and asks nothing', async () => {
    await engine.setMode(frogThread().id, 'plan');
    expect(engine.snapshot().agents[0].autonomy).toBe('plan');
    const results: string[] = [];
    runner.scripts.set('Frog', async (req, sink) => {
      for (const [tool, input] of [['Read', { file_path: 'notes.md' }], ['Write', { file_path: 'notes.md', content: 'x' }], ['Bash', { command: 'ls' }], ['mcp__ros__list_projects', {}], ['mcp__ros__create_post_action', {}]] as const) {
        results.push(`${tool}:${(await req.canUseTool(tool, input as never, { signal: req.abort.signal } as never))!.behavior}`);
      }
      sink.textDone('1. do it');
    });
    await engine.sendMessage(frogThread().id, 'plan it');
    await engine.idle();
    expect(results).toEqual(['Read:allow', 'Write:deny', 'Bash:deny', 'mcp__ros__list_projects:allow', 'mcp__ros__create_post_action:deny']);
    expect(engine.messages(frogThread().id).some((m) => m.kind === 'approval')).toBe(false);
  });

  it('auto mode runs commands without asking; a group mode overrides each agent', async () => {
    await engine.setMode(frogThread().id, 'auto');
    const decisions: string[] = [];
    runner.scripts.set('Frog', async (req, sink) => {
      decisions.push((await req.canUseTool('Bash', { command: 'ls' }, { signal: req.abort.signal } as never))!.behavior);
      sink.textDone('ok');
    });
    await engine.sendMessage(frogThread().id, 'list files');
    await engine.idle();
    expect(decisions).toEqual(['allow']);

    const group = engine.createGroup('Careful', [frogThread().memberIds[0]]);
    await engine.setMode(group.id, 'plan');
    await engine.sendMessage(group.id, 'list files');
    await engine.idle();
    expect(decisions).toEqual(['allow', 'deny']);
    await expect(engine.setMode(frogThread().id, 'each')).rejects.toThrow();
  });
});
