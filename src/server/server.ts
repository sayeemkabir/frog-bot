import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import config from '../../config/frogbot.config.json';
import { FrogEngine, defaultPlatformName, type AppConfig } from '../core/engine';
import { FrogPaths } from '../core/paths';
import { FileSecretBox } from '../core/secrets';
import { FROG_API_METHODS, type FrogApi } from '../shared/types';
import { apiKeyFromEnv, loadDotEnv, openAiKeyFromEnv } from '../main/env';

/**
 * Headless Frog Bot: the same engine as the desktop app, served over HTTP and a
 * WebSocket so the team can use it from a browser once it moves to a server.
 *
 *   FROG_SERVER_TOKEN=… FROG_SERVER_PORT=4777 npm run server
 *   open http://<host>:4777/?token=…
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(appRoot, '.env'));

const token = process.env.FROG_SERVER_TOKEN;
if (!token || token === 'change-me' || token.length < 16) {
  console.error('Set FROG_SERVER_TOKEN to a long random value (16+ characters) before starting the server.');
  process.exit(1);
}
const port = Number(process.env.FROG_SERVER_PORT || 4777);
const uiDir = path.join(appRoot, 'dist', 'renderer');

const paths = new FrogPaths();
paths.ensure();
const engine = new FrogEngine({
  paths,
  config: config as AppConfig,
  secrets: new FileSecretBox(path.join(paths.stateDir, 'secrets.json')),
  envApiKey: apiKeyFromEnv(),
  envOpenAiKey: openAiKeyFromEnv(),
  host: {
    platform: `${defaultPlatformName()} server`,
    openExternal: async (url) => {
      // No browser here: show the sign-in link in the log and the UI instead.
      engine.log.warn('server', 'Open this link in your browser to sign in', url);
    },
    openPath: async (target) => {
      engine.log.info('server', 'Files live on the server at', target);
    },
    notify: (title, body) => engine.log.info('notify', title, body),
    // On a server nobody watches the screen: each agent gets its own headless
    // Chromium (install once with `npx playwright install chromium`).
    nodeRuntime: () => ({ command: process.execPath, env: {}, browserArgs: ['--headless', '--browser', 'chromium'] }),
  },
});

const api: FrogApi = {
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
  // A server has no screen to show a browser on.
  openAgentBrowser: async () => {
    throw new Error('Signing in through an agent browser needs the desktop app.');
  },
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
  openPath: async () => undefined,
  deleteTask: async (id) => engine.deleteTask(id),
  logs: async (limit) => engine.logs(limit),
  clearLogs: async () => engine.clearLogs(),
  openLogsFolder: async () => undefined,
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let file: string;
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    file = path.normalize(path.join(uiDir, decodeURIComponent(url.pathname)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (file !== uiDir && !file.startsWith(uiDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(uiDir, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(500).end('UI not built. Run: npm run build');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const sameToken = (given: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/ws' || !sameToken(url.searchParams.get('token') ?? '')) {
    engine.log.warn('server', 'Rejected a connection with a wrong token', req.socket.remoteAddress);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  engine.log.info('server', `UI connected (${clients.size} open)`);
  ws.on('message', async (raw) => {
    let id = 0;
    try {
      const { id: reqId, method, args } = JSON.parse(String(raw));
      id = reqId;
      if (!FROG_API_METHODS.includes(method)) throw new Error(`Unknown method: ${method}`);
      const fn = api[method as keyof FrogApi] as (...a: unknown[]) => Promise<unknown>;
      const result = await fn(...(Array.isArray(args) ? args : []));
      ws.send(JSON.stringify({ id, result }));
    } catch (err) {
      ws.send(JSON.stringify({ id, error: err instanceof Error ? err.message : String(err) }));
    }
  });
  ws.on('close', () => clients.delete(ws));
});

engine.onEvent((event) => {
  const data = JSON.stringify({ event });
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
});

await engine.start();
server.listen(port, () => {
  engine.log.info('server', `Frog Bot server listening on http://localhost:${port}`);
  console.log(`Frog Bot server: http://localhost:${port}/?token=<FROG_SERVER_TOKEN>`);
});

const shutdown = () => {
  engine.stop();
  server.close();
  process.exit(0);
};
process.on('unhandledRejection', (err) => engine.log.error('server', 'Unhandled error', String(err)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
