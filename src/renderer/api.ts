import { FROG_API_METHODS, type EngineEvent, type FrogApi } from '../shared/types';

interface DesktopBridge {
  platform: string;
  call(method: string, args: unknown[]): Promise<unknown>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  onFocusConversation(listener: (conversationId: string) => void): () => void;
}

declare global {
  interface Window {
    frog?: DesktopBridge;
  }
}

type Listener = (event: EngineEvent) => void;

export interface Transport {
  api: FrogApi;
  platform: string;
  onEvent(listener: Listener): () => void;
  onFocusConversation(listener: (conversationId: string) => void): () => void;
}

function buildApi(call: (method: string, args: unknown[]) => Promise<unknown>): FrogApi {
  const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of FROG_API_METHODS) api[method] = (...args) => call(method, args);
  return api as unknown as FrogApi;
}

/** Desktop: talk to the engine in the Electron main process. */
function desktopTransport(bridge: DesktopBridge): Transport {
  return {
    api: buildApi((method, args) => bridge.call(method, args).catch((err: Error) => {
      // Electron prefixes errors with "Error invoking remote method ...: Error: ".
      throw new Error(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    })),
    platform: bridge.platform,
    onEvent: (listener) => bridge.onEvent(listener),
    onFocusConversation: (listener) => bridge.onFocusConversation(listener),
  };
}

/** Hosted: talk to `npm run server` over a WebSocket. */
function serverTransport(): Transport {
  const listeners = new Set<Listener>();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const params = new URLSearchParams(location.search);
  const token = params.get('token') ?? localStorage.getItem('frog-token') ?? '';
  if (params.get('token')) localStorage.setItem('frog-token', token);
  let socket: WebSocket;
  let ready: Promise<void>;
  let nextId = 1;

  const connect = () => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`;
    socket = new WebSocket(url);
    ready = new Promise((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Cannot reach the Frog Bot server'));
    });
    socket.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.event) for (const l of listeners) l(data.event);
      else if (data.id && pending.has(data.id)) {
        const p = pending.get(data.id)!;
        pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error));
        else p.resolve(data.result);
      }
    };
    socket.onclose = () => setTimeout(connect, 1500);
  };
  connect();

  return {
    api: buildApi(async (method, args) => {
      await ready;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, args }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }),
    platform: 'web',
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFocusConversation: () => () => undefined,
  };
}

export const transport: Transport = window.frog ? desktopTransport(window.frog) : serverTransport();
export const api = transport.api;
