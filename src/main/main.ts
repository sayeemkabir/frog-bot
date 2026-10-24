import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  screen,
  shell,
  Tray,
} from 'electron';
import config from '../../config/frogbot.config.json';
import { FrogEngine, defaultPlatformName, type AppConfig, type EngineHost } from '../core/engine';
import { FrogPaths } from '../core/paths';
import { FileSecretBox } from '../core/secrets';
import { FROG_API_METHODS, type FrogApi } from '../shared/types';
import { apiKeyFromEnv, loadDotEnv, openAiKeyFromEnv } from './env';
import { runSmoke } from './smoke';
import { DemoRunner } from './demoRunner';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const appRoot = path.resolve(here, '..', '..');
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const smokeDir = process.argv.find((a) => a.startsWith('--smoke='))?.slice('--smoke='.length);

loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(appRoot, '.env'));

if (smokeDir) {
  // The self-test captures the window while it sits behind other windows.
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

if (!smokeDir && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('com.sayeemkabir.frogbot');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayHintShown = false;
let engine: FrogEngine;

function iconPath(name: string) {
  const candidates = [path.join(appRoot, 'build', name), path.join(process.resourcesPath ?? '', name)];
  return candidates.find((p) => fs.existsSync(p));
}

/** The engine's native binary lives outside the asar archive in a packaged app. */
function claudeExecutable() {
  if (!app.isPackaged) return undefined;
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  // Look on disk first (works however the package was assembled), then via module resolution.
  const direct = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', ...pkg.split('/'), name);
  if (fs.existsSync(direct)) return direct;
  try {
    const resolved = path.join(path.dirname(requireHere.resolve(`${pkg}/package.json`)), name);
    return resolved.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  } catch {
    return undefined;
  }
}

/** Only the app's own page may call the engine. */
function isTrustedSender(url: string | undefined) {
  if (!url) return false;
  if (isDev) return url.startsWith(process.env.VITE_DEV_SERVER_URL!);
  const page = pathToFileURL(path.join(appRoot, 'dist', 'renderer', 'index.html')).href;
  return url.split('#')[0].split('?')[0] === page;
}

function showWindow(conversationId?: string) {
  if (!mainWindow) createWindow();
  mainWindow!.show();
  mainWindow!.focus();
  if (conversationId) mainWindow!.webContents.send('frog:focus-conversation', conversationId);
}

const host: EngineHost = {
  platform: defaultPlatformName(),
  openExternal: (url) => shell.openExternal(url),
  openPath: async (target) => {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  },
  notify: (title, body, conversationId) => {
    if (smokeDir || !Notification.isSupported()) return;
    if (mainWindow?.isFocused()) return;
    const notification = new Notification({ title, body, icon: iconPath('icon.png'), silent: false });
    notification.on('click', () => showWindow(conversationId));
    notification.show();
  },
  nodeRuntime: () => ({ command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }),
  claudeExecutable,
  setStartAtLogin: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] }),
  captureScreen: async () => {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width, height: display.size.height },
    });
    const image = sources[0]?.thumbnail;
    return image && !image.isEmpty() ? image.toPNG() : null;
  },
};

function createEngine() {
  const paths = new FrogPaths(smokeDir ? path.join(smokeDir, 'FrogsWorld') : undefined);
  paths.ensure();
  // The self-test uses a throwaway folder; skip the keychain so it can never prompt.
  const encryption = !smokeDir && safeStorage.isEncryptionAvailable();
  const secrets = new FileSecretBox(
    path.join(paths.stateDir, 'secrets.json'),
    encryption ? (plain) => safeStorage.encryptString(plain).toString('base64') : undefined,
    encryption ? (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64')) : undefined,
  );
  const created = new FrogEngine({
    paths,
    config: config as AppConfig,
    secrets,
    host,
    envApiKey: smokeDir && !process.env.FROG_SMOKE_LIVE ? undefined : apiKeyFromEnv(),
    envOpenAiKey: smokeDir && !process.env.FROG_SMOKE_LIVE ? undefined : openAiKeyFromEnv(),
    // The self-test must never open a real sign-in in the user's browser.
    allowSignIn: !smokeDir,
    // FROG_SMOKE_DEMO plays a scripted scene so the self-test can show live work without any AI cost.
    runner: smokeDir && process.env.FROG_SMOKE_DEMO ? new DemoRunner() : undefined,
  });
  if (!encryption) created.log.warn('app', 'OS keychain encryption unavailable; secrets are stored unencrypted in state/secrets.json');
  return created;
}

/** The FrogApi the UI calls, backed by the engine. */
function buildApi(): FrogApi {
  return {
    snapshot: async () => engine.snapshot(),
    messages: async (id) => engine.messages(id),
    sendMessage: (id, text) => engine.sendMessage(id, text),
    stopConversation: (id) => engine.stopConversation(id),
    createAgent: async (input) => engine.createAgent(input),
    updateAgent: async (id, patch) => engine.updateAgent(id, patch),
    deleteAgent: async (id) => engine.deleteAgent(id),
    createGroup: async (title, members) => engine.createGroup(title, members),
    updateGroup: async (id, patch) => engine.updateGroup(id, patch),
    setMode: (id, mode) => engine.setMode(id, mode),
    openAgentBrowser: (id, url) => engine.openAgentBrowser(id, url),
    deleteConversation: async (id) => engine.deleteConversation(id),
    answerQuestion: (id, answer) => engine.answerQuestion(id, answer),
    decideApproval: (id, decision) => engine.decideApproval(id, decision),
    decideAgentRequest: (id, decision) => engine.decideAgentRequest(id, decision),
    setApiKey: (key) => engine.setApiKey(key),
    updateSettings: (patch) => engine.updateSettings(patch),
    addIntegration: async (input) => engine.addIntegration(input),
    removeIntegration: async (id) => engine.integrations.remove(id),
    setIntegrationEnabled: async (id, enabled) => engine.integrations.setEnabled(id, enabled),
    connectIntegration: (id) => engine.integrations.connect(id),
    disconnectIntegration: async (id) => engine.integrations.disconnect(id),
    listFiles: async (agentId, sub) => engine.listFiles(agentId, sub),
    // Only things Frog Bot owns can be opened from the UI (never an arbitrary program).
    openPath: async (target) => {
      if (!FrogPaths.isInside(engine.paths.root, target)) throw new Error('Frog Bot only opens files inside FrogsWorld');
      await host.openPath(target);
    },
    deleteTask: async (id) => engine.deleteTask(id),
    logs: async (limit) => engine.logs(limit),
    clearLogs: async () => engine.clearLogs(),
    openLogsFolder: () => host.openPath(engine.paths.logsDir),
  };
}

function createWindow() {
  const icon = iconPath('icon.png');
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Frog Bot',
    backgroundColor: '#0a0c0b',
    icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#0a0c0b', symbolColor: '#9aa79f', height: 38 },
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Agents keep working while the window is in the background; keep the UI live too.
      backgroundThrottling: false,
    },
  });

  // UI warnings and errors show up in the Logs tab like everything else.
  mainWindow.webContents.on('console-message', (event) => {
    const { level, message } = event as unknown as { level: string | number; message: string };
    const severity = typeof level === 'number' ? level : ({ warning: 2, error: 3 } as Record<string, number>)[level] ?? 0;
    if (severity >= 2) engine?.log.log(severity >= 3 ? 'error' : 'warn', 'ui', message);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => engine?.log.error('ui', 'Window crashed', details));

  // The window only ever shows Frog Bot itself; links open in the real browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else mainWindow.loadFile(path.join(appRoot, 'dist', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden') && !smokeDir) mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (quitting || smokeDir) return;
    // Agents keep working in the background; the tray icon brings the window back.
    event.preventDefault();
    mainWindow?.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      host.notify('Frog Bot is still running', 'Your agents keep working. Open Frog Bot from the tray icon.');
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const trayIcon = iconPath('tray.png') ?? iconPath('icon.png');
  if (!trayIcon) return;
  tray = new Tray(nativeImage.createFromPath(trayIcon).resize({ width: 18, height: 18 }));
  tray.setToolTip('Frog Bot: your agents are running');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Frog Bot', click: () => showWindow() },
      { label: 'Open FrogsWorld folder', click: () => shell.openPath(engine.paths.root) },
      { type: 'separator' },
      {
        label: 'Quit Frog Bot',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showWindow());
}

app.on('second-instance', () => showWindow());
app.on('activate', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
  engine?.stop();
});
app.on('window-all-closed', () => {
  if (smokeDir) app.quit();
});

app.whenReady().then(async () => {
  engine = createEngine();
  const api = buildApi();

  ipcMain.handle('frog:call', async (event, method: keyof FrogApi, args: unknown[]) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error('Not allowed from this page');
    if (!FROG_API_METHODS.includes(method)) throw new Error(`Unknown method: ${String(method)}`);
    const started = Date.now();
    try {
      const fn = api[method] as (...a: unknown[]) => Promise<unknown>;
      const result = await fn(...(Array.isArray(args) ? args : []));
      if (method !== 'logs' && method !== 'messages' && method !== 'snapshot' && method !== 'listFiles') {
        engine.log.debug('ui', `${method} ok (${Date.now() - started} ms)`);
      }
      return result;
    } catch (err) {
      engine.log.warn('ui', `${method} failed`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  });

  engine.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('frog:event', event);
  });

  Menu.setApplicationMenu(null);
  try {
    await engine.start();
  } catch (err) {
    dialog.showErrorBox('Frog Bot could not start', err instanceof Error ? err.message : String(err));
    quitting = true;
    app.exit(1);
    return;
  }
  createWindow();
  if (!smokeDir) createTray();

  if (smokeDir) {
    const code = await runSmoke({ engine, window: mainWindow!, outDir: smokeDir });
    quitting = true;
    app.exit(code);
  }
});
