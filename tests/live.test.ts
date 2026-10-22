// Live checks against a real model. Skipped unless FROG_LIVE=1 and a key is available:
//   FROG_LIVE=1 npx vitest run tests/live.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import config from '../config/frogbot.config.json';
import { FrogEngine, type AppConfig } from '../src/core/engine';
import { FrogPaths } from '../src/core/paths';
import { MemorySecretBox } from '../src/core/secrets';
import { apiKeyFromEnv, loadDotEnv, openAiKeyFromEnv } from '../src/main/env';
import type { Message } from '../src/shared/types';

loadDotEnv(path.join(process.cwd(), '.env'));
const claudeKey = apiKeyFromEnv();
const openAiKey = openAiKeyFromEnv();
const live = process.env.FROG_LIVE === '1' && Boolean(claudeKey || openAiKey);

let dir: string;
let engine: FrogEngine;

const thread = (name: string) => engine.snapshot().conversations.find((c) => c.kind === 'direct' && c.title === name)!;
const agentMessages = (id: string) => engine.messages(id).filter((m: Message) => m.author.kind === 'agent' && m.kind === 'text');
const lastReply = (id: string) => agentMessages(id).at(-1)?.text ?? '';

/** Answer questions/approvals automatically while a turn runs. */
function autopilot(conversationId: string, answers: { approve?: boolean; answer?: string }) {
  const handled = new Set<string>();
  const timer = setInterval(() => {
    for (const m of engine.messages(conversationId)) {
      if (handled.has(m.id)) continue;
      if (m.kind === 'approval' && !m.approval?.decision) {
        handled.add(m.id);
        engine.decideApproval(m.id, answers.approve === false ? 'deny' : 'allow');
      }
      if (m.kind === 'question' && !m.question?.answer) {
        handled.add(m.id);
        engine.answerQuestion(m.id, answers.answer ?? m.question!.options[0]);
      }
    }
  }, 100);
  return () => clearInterval(timer);
}

describe.skipIf(!live)(`live agents (${claudeKey ? 'Claude' : 'OpenAI'})`, () => {
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-live-'));
    engine = new FrogEngine({
      paths: new FrogPaths(dir),
      config: { ...(config as AppConfig), integrations: (config as AppConfig).integrations.filter((i) => i.id === 'browser') },
      secrets: new MemorySecretBox(),
      host: {
        platform: 'Windows',
        openExternal: async () => undefined,
        openPath: async () => undefined,
        notify: () => undefined,
        nodeRuntime: () => ({ command: process.execPath, env: {} }),
      },
      envApiKey: claudeKey,
      envOpenAiKey: openAiKey,
    });
    await engine.start();
  }, 60_000);

  afterAll(() => {
    engine?.stop();
    // Chrome may still hold the agent's browser profile for a moment; leftovers in temp are harmless.
    if (process.env.FROG_LIVE_KEEP !== '1') try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* ignore */ }
  });

  it('answers a simple question', async () => {
    await engine.sendMessage(thread('Frog').id, 'Reply with exactly the word: ribbit');
    await engine.idle();
    expect(lastReply(thread('Frog').id).toLowerCase()).toContain('ribbit');
  }, 120_000);

  it('works with files in its own folder', async () => {
    await engine.sendMessage(thread('Frog').id, 'Create a file called hello.txt in your folder containing the text "frogs are great", then read it back and tell me what it says.');
    await engine.idle();
    const file = path.join(dir, 'agents', 'frog', 'hello.txt');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('frogs are great');
    expect(lastReply(thread('Frog').id).toLowerCase()).toContain('frogs are great');
  }, 180_000);

  it('hands work to a teammate', async () => {
    engine.createAgent({ name: 'Docs Guy', label: 'Writes short notes', instructions: 'When a teammate asks for a note, write it to the shared folder and reply with the file path.' });
    await engine.sendMessage(thread('Frog').id, 'Use message_agent to ask Docs Guy to write a one-line note about ponds to a file named pond-note.md in the shared folder. Then tell me you asked.');
    await engine.idle();
    expect(engine.messages(thread('Frog').id).some((m) => m.kind === 'relay')).toBe(true);
    expect(agentMessages(thread('Docs Guy').id).length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir, 'shared', 'pond-note.md'))).toBe(true);
  }, 240_000);

  it('asks the user and uses the answer', async () => {
    const stop = autopilot(thread('Frog').id, { answer: 'Blue' });
    await engine.sendMessage(thread('Frog').id, 'Use ask_user to ask me which color I like, with options Red, Green and Blue. Then tell me the color I picked.');
    await engine.idle();
    stop();
    expect(engine.messages(thread('Frog').id).some((m) => m.kind === 'question' && m.question?.answer === 'Blue')).toBe(true);
    expect(lastReply(thread('Frog').id).toLowerCase()).toContain('blue');
  }, 180_000);

  it('waits for approval before running a command', async () => {
    const stop = autopilot(thread('Frog').id, { approve: true });
    await engine.sendMessage(thread('Frog').id, 'Run the shell command: echo frog-approved   and tell me exactly what it printed.');
    await engine.idle();
    stop();
    expect(engine.messages(thread('Frog').id).some((m) => m.kind === 'approval' && m.approval?.decision === 'allow')).toBe(true);
    expect(lastReply(thread('Frog').id)).toContain('frog-approved');
  }, 180_000);

  it('drives its own browser', async () => {
    const stop = autopilot(thread('Frog').id, { approve: true });
    await engine.sendMessage(thread('Frog').id, 'Use your browser tools to open https://example.com and tell me the main heading on the page.');
    await engine.idle();
    stop();
    expect(lastReply(thread('Frog').id).toLowerCase()).toContain('example domain');
  }, 240_000);

  // A real multi-step web job: find a video, get its transcript with a tool the agent picks, extract the recipe.
  it('researches a YouTube recipe end to end', async () => {
    const stop = autopilot(thread('Frog').id, { approve: true });
    await engine.sendMessage(
      thread('Frog').id,
      [
        'Task: in your browser, go to YouTube and search for "how to bake butter bun".',
        'Open a suitable recipe video and copy its share link.',
        'Then decide for yourself which free tool is best for getting that video\'s transcript without logging in',
        '(for example YouTube\'s own "Show transcript", a free transcript website, or a free AI chat). Say which one you chose and why.',
        'Use it to get the transcript, then write the recipe (ingredients with amounts, and numbered steps) to butter-bun-recipe.md in the shared folder.',
        'Finally reply with: the video title, its share link, the tool you used, and the recipe.',
      ].join(' '),
    );
    await engine.idle();
    stop();
    const reply = lastReply(thread('Frog').id);
    fs.writeFileSync(path.join(dir, 'youtube-final-reply.md'), reply);
    expect(reply.toLowerCase()).toMatch(/youtu\.?be/);
    expect(fs.existsSync(path.join(dir, 'shared', 'butter-bun-recipe.md'))).toBe(true);
    const recipe = fs.readFileSync(path.join(dir, 'shared', 'butter-bun-recipe.md'), 'utf8').toLowerCase();
    expect(recipe).toMatch(/flour/);
    expect(recipe).toMatch(/butter/);
  }, 900_000);
});
