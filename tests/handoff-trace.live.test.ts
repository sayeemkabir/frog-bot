// Diagnoses a slow or looping hand-off: runs one, stops after 90 s, saves the agents' log.
//   FROG_LIVE=1 npx vitest run tests/handoff-trace.live.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'vitest';
import config from '../config/frogbot.config.json';
import { FrogEngine, type AppConfig } from '../src/core/engine';
import { FrogPaths } from '../src/core/paths';
import { MemorySecretBox } from '../src/core/secrets';
import { loadDotEnv, openAiKeyFromEnv } from '../src/main/env';

loadDotEnv(path.join(process.cwd(), '.env'));
it.skipIf(process.env.FROG_LIVE !== '1')('hand-off trace', async () => {
  const engine = new FrogEngine({
    paths: new FrogPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'frog-trace-'))),
    config: config as AppConfig,
    secrets: new MemorySecretBox(),
    host: { platform: 'Windows', openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined, nodeRuntime: () => ({ command: process.execPath, env: {} }) },
    envOpenAiKey: openAiKeyFromEnv(),
    allowSignIn: false,
  });
  await engine.start();
  const frog = engine.snapshot().conversations[0];
  await engine.setMode(frog.id, 'auto');
  engine.createAgent({ name: 'Scout', label: 'Researcher', autonomy: 'auto', instructions: 'Find facts fast and reply to whoever asked with the answer and a source.' });
  const start = Date.now();
  await engine.sendMessage(frog.id, 'Ask Scout to find the population of Iceland and tell me what Scout found.');
  await Promise.race([engine.idle(), new Promise((r) => setTimeout(r, 90_000))]);
  const lines = engine.logs().map((l) => `${((l.at - start) / 1000).toFixed(1).padStart(6)}s ${l.source.padEnd(16)} ${l.message} ${String(l.data ?? '').replace(/\s+/g, ' ').slice(0, 150)}`);
  fs.writeFileSync('speed-trace.log', lines.join('\n'));
  for (const c of engine.snapshot().conversations) {
    for (const m of engine.messages(c.id)) fs.appendFileSync('speed-trace.log', `\n[${c.title}] ${m.author.kind}/${m.kind}: ${m.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  engine.stop();
}, 120_000);
