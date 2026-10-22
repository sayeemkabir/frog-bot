// Proves the Claude engine is wired up (binary starts, reaches Anthropic, errors
// surface in the chat) using a deliberately invalid key, so it costs nothing.
//   FROG_WIRING=1 npx vitest run tests/claude-wiring.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import config from '../config/frogbot.config.json';
import { FrogEngine, type AppConfig } from '../src/core/engine';
import { FrogPaths } from '../src/core/paths';
import { MemorySecretBox } from '../src/core/secrets';

it.skipIf(process.env.FROG_WIRING !== '1')('Claude engine starts and reports a bad key clearly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-wiring-'));
  const engine = new FrogEngine({
    paths: new FrogPaths(dir),
    config: { ...(config as AppConfig), integrations: [] },
    secrets: new MemorySecretBox(),
    host: { platform: 'Windows', openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined, nodeRuntime: () => ({ command: process.execPath, env: {} }) },
    envApiKey: 'sk-ant-api03-this-is-not-a-real-key-000000000000000000000000',
  });
  await engine.start();
  expect(engine.settings().provider).toBe('anthropic');
  const thread = engine.snapshot().conversations[0];
  await engine.sendMessage(thread.id, 'hello');
  await engine.idle();
  const last = engine.messages(thread.id).at(-1)!;
  const logs = engine.logs().map((l) => `${l.source} ${l.message} ${l.data ?? ''}`).join('\n');
  fs.writeFileSync(path.join(os.tmpdir(), 'frog-wiring-log.txt'), logs);
  engine.stop();
  expect(logs).toMatch(/Engine ready/);
  expect(last.kind === 'error' || last.kind === 'text').toBe(true);
  expect(last.kind).toBe('error');
  expect(last.text).toContain('Claude rejected the API key');
  expect(engine.messages(thread.id).filter((m) => m.author.kind === 'agent' && m.kind === 'text')).toHaveLength(0);
}, 180_000);
