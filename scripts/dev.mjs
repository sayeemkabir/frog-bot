// npm run dev → UI with hot reload, main process rebuilt on save (the app restarts).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';
import electron from 'electron';
import { buildMain, root, watchMain } from './tasks.mjs';

const vite = await createServer({ configFile: path.join(root, 'vite.config.mjs') });
await vite.listen();
const url = vite.resolvedUrls.local[0];

await buildMain();

let child = null;
let restarting = false;
const start = () => {
  child = spawn(electron, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  child.on('exit', (code) => {
    if (restarting) return;
    vite.close();
    process.exit(code ?? 0);
  });
};

await watchMain(() => {
  if (!child) return;
  restarting = true;
  child.once('exit', () => {
    restarting = false;
    start();
  });
  child.kill();
});

start();
console.log(`Frog Bot dev: UI at ${url}`);
