import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where Chrome (or Edge/Chromium, which the agent browser can also use) usually lives. */
function candidates(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
    return roots.flatMap((r) => [path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  return [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/brave-browser',
  ];
}

export function findBrowser() {
  return candidates().find((p) => fs.existsSync(p));
}

const CHROMIUM_NAMES = new Set(['chrome', 'chrome.exe', 'Chromium']);

/** Frog Bot's own Chromium (downloaded once when the computer has no Chrome, Edge or Chromium). */
export function ownChromium(browsersDir: string) {
  if (!fs.existsSync(browsersDir)) return undefined;
  const search = (dir: string, depth: number): string | undefined => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && CHROMIUM_NAMES.has(entry.name) && !full.includes('headless')) return full;
      if (entry.isDirectory() && depth > 0 && !entry.name.includes('headless')) {
        const found = search(full, depth - 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  for (const dir of fs.readdirSync(browsersDir).filter((d) => d.startsWith('chromium-'))) {
    // Mac: chrome-mac/Chromium.app/Contents/MacOS/Chromium
    const found = search(path.join(browsersDir, dir), 5);
    if (found) return found;
  }
  return undefined;
}

/** The browser agents use: the computer's own, else Frog Bot's Chromium. */
export function agentBrowserPath(browsersDir: string) {
  return findBrowser() ?? ownChromium(browsersDir);
}

/** How to start the agents' browser server: point it at a browser that is really there. */
export function browserLaunchArgs(browsersDir: string) {
  const browser = agentBrowserPath(browsersDir);
  return browser ? ['--executable-path', browser] : ['--browser', 'chromium'];
}

let installing: Promise<void> | undefined;

/**
 * Download Chromium for the agents when the computer has no browser they can
 * use (common on Linux). One time, about 150 MB, into browsersDir.
 */
export function ensureAgentBrowser(browsersDir: string, node: { command: string; env: Record<string, string> }, log: (message: string) => void) {
  if (agentBrowserPath(browsersDir)) return Promise.resolve();
  if (installing) return installing;
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js')
    .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  log('No Chrome, Edge or Chromium found: downloading a browser for the agents (one time)');
  installing = new Promise<void>((resolve, reject) => {
    const child = spawn(node.command, [cli, 'install', 'chromium'], {
      env: { ...process.env, ...node.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 && ownChromium(browsersDir) ? resolve() : reject(new Error(`Browser download failed (exit ${code})`))));
  }).finally(() => {
    installing = undefined;
  });
  return installing;
}

/**
 * Open an agent's own browser profile in a normal window, so the user can sign
 * in to a site once (or finish a 2FA step). The agent's browser reuses the same
 * profile, so it stays signed in afterwards.
 */
export function openProfileWindow(profileDir: string, url = 'about:blank', browsersDir?: string) {
  const browser = browsersDir ? agentBrowserPath(browsersDir) : findBrowser();
  if (!browser) throw new Error('No browser yet. Frog Bot is downloading one for the agents; try again in a minute.');
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(browser, [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--new-window', url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
