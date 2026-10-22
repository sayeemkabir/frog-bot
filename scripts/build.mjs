// npm run build           → desktop app (main, preload, UI) into dist/
// npm run build -- --server → also the headless server
import fs from 'node:fs';
import path from 'node:path';
import { buildMain, buildRenderer, buildServer, root } from './tasks.mjs';

const withServer = process.argv.includes('--server');
const started = Date.now();

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
await buildMain();
await buildRenderer();
if (withServer) await buildServer();
console.log(`✓ Frog Bot built in ${((Date.now() - started) / 1000).toFixed(1)}s${withServer ? ' (with server)' : ''}`);
