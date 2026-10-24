import { spawn } from 'node:child_process';
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
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
}

export function findBrowser() {
  return candidates().find((p) => fs.existsSync(p));
}

/**
 * Open an agent's own browser profile in a normal window, so the user can sign
 * in to a site once (or finish a 2FA step). The agent's browser reuses the same
 * profile, so it stays signed in afterwards.
 */
export function openProfileWindow(profileDir: string, url = 'about:blank') {
  const browser = findBrowser();
  if (!browser) throw new Error('Google Chrome was not found on this computer. Install Chrome, then try again.');
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(browser, [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--new-window', url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
