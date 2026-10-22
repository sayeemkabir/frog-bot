// npm run smoke [-- --runs 3] [-- --live]
// Launches the real desktop app against a throwaway FrogsWorld, lets it click
// through every screen (src/main/smoke.ts), and prints what passed. Screenshots
// land in smoke-output/run-N/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { root } from './tasks.mjs';

const argv = process.argv.slice(2);
const runs = Number(argv[argv.indexOf('--runs') + 1]) || 1;
const live = argv.includes('--live');
const outRoot = path.join(root, 'smoke-output');
fs.rmSync(outRoot, { recursive: true, force: true });

let failures = 0;
for (let run = 1; run <= runs; run++) {
  const dir = path.join(outRoot, `run-${run}`);
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const code = await new Promise((resolve) => {
    // CI Linux machines lack Electron's setuid sandbox helper.
    const extra = process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [];
    const child = spawn(electron, ['.', `--smoke=${dir}`, ...extra], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(live ? { FROG_SMOKE_LIVE: '1' } : {}), ELECTRON_ENABLE_LOGGING: '0' },
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      if (c !== 0 && stderr.trim()) fs.writeFileSync(path.join(dir, 'stderr.txt'), stderr);
      resolve(c ?? 1);
    });
  });
  const resultsFile = path.join(dir, 'results.json');
  const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : null;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!results) {
    failures++;
    console.log(`✗ run ${run}: app exited with code ${code} before writing results (${seconds}s). See ${dir}`);
    continue;
  }
  console.log(`${results.failed ? '✗' : '✓'} run ${run}: ${results.passed} passed, ${results.failed} failed (${seconds}s)`);
  for (const check of results.checks) if (!check.ok) console.log(`    ✗ ${check.name}${check.detail ? `: ${check.detail.split('\n')[0]}` : ''}`);
  if (results.failed || code !== 0) failures++;
}
console.log(failures ? `\n${failures} of ${runs} run(s) failed.` : `\nAll ${runs} run(s) passed. Screenshots: ${outRoot}`);
process.exit(failures ? 1 : 0);
