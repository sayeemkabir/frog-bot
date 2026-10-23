import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { McpOAuth } from '../src/core/oauth';
import { Logger } from '../src/core/logger';
import { MemorySecretBox } from '../src/core/secrets';

/** A fake server that behaves like Slack's: no client registration, confidential token exchange. */
function fakeServer() {
  const seen: { authorize?: URL; tokenBody?: URLSearchParams; registered: boolean } = { registered: false };
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = new URL(req.url || '/', base);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json({ resource: `${base}/mcp`, authorization_servers: [base] });
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
      return json({
        issuer: base,
        authorization_endpoint: `${base}/oauth/v2_user/authorize`,
        token_endpoint: `${base}/api/oauth.v2.user.access`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      });
    }
    if (url.pathname === '/register') {
      seen.registered = true;
      return json({ error: 'not supported' }, 400);
    }
    if (url.pathname === '/api/oauth.v2.user.access') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        seen.tokenBody = new URLSearchParams(body);
        json({ access_token: 'xoxp-test-token', token_type: 'user', scope: 'chat:write' });
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise<{ server: http.Server; url: string; seen: typeof seen }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, seen })),
  );
}

let toClose: http.Server[] = [];
afterEach(() => {
  for (const s of toClose) s.close();
  toClose = [];
});

describe('sign-in with your own app (Slack-style)', () => {
  it('uses the given client ID and secret, a fixed localhost redirect, and keeps the token', async () => {
    const fake = await fakeServer();
    toClose.push(fake.server);
    const secrets = new MemorySecretBox();
    const log = new Logger(fs.mkdtempSync(path.join(os.tmpdir(), 'frog-oauth-')));
    const port = 3000 + Math.floor(Math.random() * 900) + 50;
    const oauth = new McpOAuth(
      secrets,
      async (authorizeUrl) => {
        // Play the browser: the user clicks Allow and Slack redirects back.
        const u = new URL(authorizeUrl);
        fake.seen.authorize = u;
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'the-code');
        back.searchParams.set('state', u.searchParams.get('state')!);
        setTimeout(() => fetch(back).catch(() => undefined), 20);
      },
      log,
    );
    oauth.setOwnApp('slack', ' 123.456 ', 'shh-secret');
    await oauth.signIn('slack', fake.url, { scope: 'chat:write channels:history', port });

    const a = fake.seen.authorize!;
    expect(a.pathname).toBe('/oauth/v2_user/authorize');
    expect(a.searchParams.get('client_id')).toBe('123.456');
    expect(a.searchParams.get('redirect_uri')).toBe(`http://localhost:${port}/oauth/callback`);
    expect(a.searchParams.get('scope')).toBe('chat:write channels:history');
    expect(a.searchParams.get('code_challenge_method')).toBe('S256');
    expect(fake.seen.registered).toBe(false);

    const t = fake.seen.tokenBody!;
    expect(t.get('client_id')).toBe('123.456');
    expect(t.get('client_secret')).toBe('shh-secret');
    expect(t.get('code')).toBe('the-code');
    expect(t.get('redirect_uri')).toBe(`http://localhost:${port}/oauth/callback`);

    expect(await oauth.accessToken('slack', fake.url, { port })).toBe('xoxp-test-token');
    // Signing out keeps the app details; removing the integration forgets them too.
    oauth.forget('slack');
    expect(secrets.get('oauthapp:slack')).toBeTruthy();
    oauth.forget('slack', true);
    expect(secrets.get('oauthapp:slack')).toBeUndefined();
  });

  it('refuses to start without the app details, and says why', async () => {
    const oauth = new McpOAuth(new MemorySecretBox(), async () => undefined, new Logger(fs.mkdtempSync(path.join(os.tmpdir(), 'frog-oauth-'))));
    await expect(oauth.signIn('slack', 'http://127.0.0.1:9/mcp', { port: 3119 })).rejects.toThrow(/Client ID/);
  });
});
