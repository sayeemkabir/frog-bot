import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Logger } from './logger';
import type { SecretBox } from './secrets';

const CALLBACK_PATH = '/oauth/callback';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_EARLY_MS = 2 * 60 * 1000;

class NeedsSignIn extends Error {
  constructor() {
    super('Sign-in required');
  }
}

/**
 * Remembers one integration's OAuth client registration and tokens. When
 * `interactive` is false it never opens a browser: if the tokens cannot be
 * refreshed silently it throws NeedsSignIn instead.
 */
class StoredProvider implements OAuthClientProvider {
  private verifier = '';
  private expectedState = crypto.randomBytes(16).toString('hex');

  constructor(
    private id: string,
    private secrets: SecretBox,
    private redirect: string,
    private interactive: boolean,
    private openBrowser: (url: string) => Promise<void>,
    private scope?: string,
  ) {}

  get redirectUrl() { return this.redirect; }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Frog Bot',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  state() { return this.expectedState; }
  get stateValue() { return this.expectedState; }

  clientInformation() {
    return parse<OAuthClientInformationMixed>(this.secrets.get(key(this.id, 'client')));
  }

  saveClientInformation(info: OAuthClientInformationMixed) {
    this.secrets.set(key(this.id, 'client'), JSON.stringify(info));
  }

  tokens() {
    return parse<OAuthTokens>(this.secrets.get(key(this.id, 'tokens')));
  }

  saveTokens(tokens: OAuthTokens) {
    // Keep exactly what the SDK hands us (it includes the issuer), plus when.
    this.secrets.set(key(this.id, 'tokens'), JSON.stringify(tokens));
    this.secrets.set(key(this.id, 'savedAt'), String(Date.now()));
  }

  async redirectToAuthorization(url: URL) {
    if (!this.interactive) throw new NeedsSignIn();
    await this.openBrowser(url.toString());
  }

  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() { return this.verifier; }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') this.secrets.delete(key(this.id, 'client'));
    if (scope === 'all' || scope === 'tokens') {
      this.secrets.delete(key(this.id, 'tokens'));
      this.secrets.delete(key(this.id, 'savedAt'));
    }
  }
}

function key(id: string, part: string) {
  return `oauth:${id}:${part}`;
}

function parse<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Signs in to remote MCP servers that use OAuth (like the ROS dashboard).
 * The first time, it opens the user's browser on the server's sign-in page and
 * catches the redirect on a local port. After that it refreshes tokens on its
 * own, so the integration stays connected.
 */
export class McpOAuth {
  /** One refresh or sign-in at a time per integration; concurrent callers share it. */
  private inFlight = new Map<string, Promise<unknown>>();

  private once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = run().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  constructor(
    private secrets: SecretBox,
    private openBrowser: (url: string) => Promise<void>,
    private log: Logger,
  ) {}

  hasTokens(id: string) {
    return Boolean(this.secrets.get(key(id, 'tokens')));
  }

  forget(id: string) {
    for (const part of ['client', 'tokens', 'savedAt', 'redirect']) this.secrets.delete(key(id, part));
  }

  /** A valid access token without any user interaction, or undefined. */
  accessToken(id: string, serverUrl: string, scope?: string): Promise<string | undefined> {
    return this.once(`token:${id}`, () => this.accessTokenNow(id, serverUrl, scope));
  }

  /** Full sign-in. Opens the browser if needed and waits for the user to approve. */
  signIn(id: string, serverUrl: string, scope?: string): Promise<void> {
    return this.once(`signin:${id}`, () => this.signInNow(id, serverUrl, scope));
  }

  private async accessTokenNow(id: string, serverUrl: string, scope?: string): Promise<string | undefined> {
    const raw = this.secrets.get(key(id, 'tokens'));
    const tokens = parse<OAuthTokens>(raw);
    if (!tokens?.access_token) return undefined;

    const savedAt = Number(this.secrets.get(key(id, 'savedAt')) || 0);
    const expiresAt = tokens.expires_in ? savedAt + tokens.expires_in * 1000 : Infinity;
    if (Date.now() < expiresAt - REFRESH_EARLY_MS) return tokens.access_token;
    if (!tokens.refresh_token) return undefined;

    const redirect = this.secrets.get(key(id, 'redirect')) || `http://127.0.0.1:1${CALLBACK_PATH}`;
    const provider = new StoredProvider(id, this.secrets, redirect, false, this.openBrowser, scope);
    try {
      const result = await auth(provider, { serverUrl, scope });
      if (result === 'AUTHORIZED') {
        this.log.info(`oauth:${id}`, 'Access token refreshed');
        return provider.tokens()?.access_token;
      }
    } catch (err) {
      this.log.warn(`oauth:${id}`, 'Token refresh failed, sign-in needed', String(err));
    }
    return undefined;
  }

  private async signInNow(id: string, serverUrl: string, scope?: string): Promise<void> {
    const { server, port } = await this.listen(Number(this.secrets.get(key(id, 'port')) || 0));
    const redirect = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    let codePromise: Promise<string> | undefined;
    let cancelWait = () => {};
    try {
      if (this.secrets.get(key(id, 'redirect')) !== redirect) {
        // A registration is tied to its redirect address; register again.
        this.secrets.delete(key(id, 'client'));
        this.secrets.set(key(id, 'redirect'), redirect);
        this.secrets.set(key(id, 'port'), String(port));
      }
      const provider = new StoredProvider(id, this.secrets, redirect, true, async (url) => {
        this.log.info(`oauth:${id}`, 'Opening browser for sign-in', url.split('?')[0]);
        await this.openBrowser(url);
      }, scope);

      const waiting = this.waitForCode(server, provider.stateValue);
      codePromise = waiting.promise;
      cancelWait = waiting.cancel;
      const first = await auth(provider, { serverUrl, scope });
      if (first === 'AUTHORIZED') {
        this.log.info(`oauth:${id}`, 'Already signed in');
        return;
      }
      const code = await codePromise;
      const second = await auth(provider, { serverUrl, scope, authorizationCode: code });
      if (second !== 'AUTHORIZED') throw new Error('Sign-in did not complete');
      this.log.info(`oauth:${id}`, 'Signed in');
    } finally {
      // Never leave the 5-minute timer or a dangling rejection behind.
      cancelWait();
      codePromise?.catch(() => undefined);
      server.close();
    }
  }

  private listen(preferredPort: number): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      const onError = (err: NodeJS.ErrnoException) => {
        if (preferredPort && err.code === 'EADDRINUSE') {
          this.listen(0).then(resolve, reject);
        } else reject(err);
      };
      server.once('error', onError);
      server.listen(preferredPort, '127.0.0.1', () => {
        server.off('error', onError);
        resolve({ server, port: (server.address() as AddressInfo).port });
      });
    });
  }

  private waitForCode(server: http.Server, expectedState: string): { promise: Promise<string>; cancel: () => void } {
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Sign-in timed out after 5 minutes')), SIGN_IN_TIMEOUT_MS);
      server.on('request', (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const ok = Boolean(code) && state === expectedState && !error;
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(callbackPage(ok, error || (state !== expectedState ? 'state mismatch' : undefined)));
        clearTimeout(timer);
        if (ok) resolve(code!);
        else reject(new Error(`Sign-in was not completed: ${error || 'state mismatch'}`));
      });
    });
    return { promise, cancel: () => clearTimeout(timer) };
  }
}

function callbackPage(ok: boolean, error?: string) {
  const title = ok ? 'Frog Bot is connected' : 'Sign-in failed';
  const body = ok ? 'You can close this tab and go back to Frog Bot.' : `Go back to Frog Bot and try again. (${error ?? 'unknown error'})`;
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;background:#0b0f0c;color:#e8f5e9;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:56px">${ok ? '🐸' : '⚠️'}</div><h1 style="font-weight:600">${title}</h1><p style="opacity:.7">${body}</p></div></body>`;
}
