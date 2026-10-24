// Chief-of-staff run: one combined request, Frog fans out to two teammates who
// work in parallel, then Frog compiles one brief.
//   FROG_LIVE=1 npx vitest run tests/chief.live.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import config from '../config/frogbot.config.json';
import { FrogEngine, type AppConfig } from '../src/core/engine';
import { FrogPaths } from '../src/core/paths';
import { MemorySecretBox } from '../src/core/secrets';
import { loadDotEnv, openAiKeyFromEnv } from '../src/main/env';

loadDotEnv(path.join(process.cwd(), '.env'));
it.skipIf(process.env.FROG_LIVE !== '1')('Frog fans out to two teammates and compiles one brief', async () => {
  const engine = new FrogEngine({
    paths: new FrogPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'frog-chief-'))),
    config: config as AppConfig,
    secrets: new MemorySecretBox(),
    host: { platform: 'Windows', openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined, nodeRuntime: () => ({ command: process.execPath, env: {} }) },
    envOpenAiKey: openAiKeyFromEnv(),
    allowSignIn: false,
  });
  await engine.start();
  const frog = engine.snapshot().conversations[0];
  await engine.setMode(frog.id, 'auto');
  engine.createAgent({ name: 'Scout', label: 'Researcher: facts with sources', autonomy: 'auto' });
  engine.createAgent({ name: 'Quill', label: 'Writer: short posts in a friendly voice', autonomy: 'auto' });
  const start = Date.now();
  await engine.sendMessage(frog.id, 'Prepare a mini brief for me: Scout, find the height of Mount Everest in meters with a source. Quill, write a two-line social post inviting people to a team hike. Then put both into one brief.');
  for (let i = 0; i < 900; i++) {
    await engine.idle();
    const busy = Object.values(engine.snapshot().runtimes).some((r) => r.status === 'working' || r.status === 'waiting');
    if (!busy) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  const t = (l: { at: number }) => ((l.at - start) / 1000).toFixed(1).padStart(5);
  const timeline = engine.logs().filter((l) => /Turn (started|finished)|Messaged|Tool →/.test(l.message)).map((l) => `${t(l)}s ${l.source} ${l.message}`);
  const brief = engine.messages(frog.id).filter((m) => m.author.kind === 'agent' && m.kind === 'text').at(-1)?.text ?? '';
  fs.writeFileSync('chief-trace.log', `${timeline.join('\n')}\n\nTOTAL ${seconds}s\n\nFINAL BRIEF:\n${brief}\n`);
  engine.stop();
  expect(brief).toMatch(/8,?8\d\d/);
  expect(brief.toLowerCase()).toMatch(/hike/);
}, 300_000);
