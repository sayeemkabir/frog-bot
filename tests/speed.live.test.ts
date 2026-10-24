// Times real agent turns so speed changes can be measured, not guessed.
//   FROG_LIVE=1 npx vitest run tests/speed.live.test.ts
// Prints a table and appends it to speed-results.md (git-ignored).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import config from '../config/frogbot.config.json';
import { FrogEngine, type AppConfig } from '../src/core/engine';
import { FrogPaths } from '../src/core/paths';
import { MemorySecretBox } from '../src/core/secrets';
import { apiKeyFromEnv, loadDotEnv, openAiKeyFromEnv } from '../src/main/env';

loadDotEnv(path.join(process.cwd(), '.env'));
const openAiKey = openAiKeyFromEnv();
const live = process.env.FROG_LIVE === '1' && Boolean(openAiKey || apiKeyFromEnv());

const TASKS = [
  { name: 'Short reply (overhead per message)', prompt: 'Reply with exactly: OK', check: /\bOK\b/ },
  { name: 'Short reply again (warm)', prompt: 'Reply with exactly: OK', check: /\bOK\b/ },
  { name: 'Web research', prompt: 'In what year was the Eiffel Tower completed? Look it up and answer in one sentence with the source URL.', check: /1889/ },
  { name: 'Browser task', prompt: 'Use your browser to open https://example.com and tell me the main heading on the page.', check: /example domain/i },
  { name: 'Hand-off to a teammate', prompt: 'Ask Scout to find the population of Iceland and tell me what Scout found.', check: /[0-9]{3}[,. ]?[0-9]{3}|thousand/i, team: true },
];

let engine: FrogEngine;
const rows: string[] = [];

describe.skipIf(!live)('speed benchmark', () => {
  beforeAll(async () => {
    engine = new FrogEngine({
      paths: new FrogPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'frog-speed-'))),
      config: config as AppConfig,
      secrets: new MemorySecretBox(),
      host: { platform: 'Windows', openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined, nodeRuntime: () => ({ command: process.execPath, env: {} }) },
      envApiKey: apiKeyFromEnv(),
      envOpenAiKey: openAiKey,
      allowSignIn: false,
    });
    await engine.start();
    await engine.setMode(engine.snapshot().conversations[0].id, 'auto');
  }, 60_000);

  afterAll(() => {
    engine?.stop();
    const label = process.env.FROG_SPEED_LABEL || new Date().toISOString();
    const table = `\n### ${label}\n\n| Task | Seconds | Steps |\n|---|---|---|\n${rows.join('\n')}\n`;
    console.log(table);
    fs.appendFileSync('speed-results.md', table);
  });

  for (const task of TASKS) {
    it(task.name, async () => {
      if ((task as { team?: boolean }).team && !engine.snapshot().agents.some((a) => a.name === 'Scout')) {
        engine.createAgent({ name: 'Scout', label: 'Researcher', autonomy: 'auto', instructions: 'Find facts fast and reply to whoever asked with the answer and a source.' });
      }
      const thread = engine.snapshot().conversations.find((c) => c.title === 'Frog')!;
      const before = engine.logs().length;
      const start = Date.now();
      await engine.sendMessage(thread.id, task.prompt);
      await engine.idle();
      // A hand-off finishes when the teammate's answer has come back and everyone is idle.
      for (let i = 0; i < 600 && Object.values(engine.snapshot().runtimes).some((r) => r.status === 'working'); i++) {
        await new Promise((r) => setTimeout(r, 200));
        await engine.idle();
      }
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      const steps = engine.logs().slice(before).filter((l) => l.message.startsWith('Tool →')).length;
      const reply = engine.messages(thread.id).filter((m) => m.author.kind === 'agent' && m.kind === 'text').at(-1)?.text ?? '';
      rows.push(`| ${task.name} | ${seconds} | ${steps} |`);
      expect(reply).toMatch(task.check);
    }, 300_000);
  }
});
