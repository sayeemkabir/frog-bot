import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../config/frogbot.config.json';
import { Integrations } from '../src/core/integrations';
import { Logger } from '../src/core/logger';
import { McpOAuth } from '../src/core/oauth';
import { MemorySecretBox } from '../src/core/secrets';

describe('integrations cleanup', () => {
  it('forgets saved sign-ins and settings of apps that are no longer in Frog Bot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-int-'));
    const stateFile = path.join(dir, 'integrations.json');
    fs.writeFileSync(stateFile, JSON.stringify({ added: [], disabled: ['old-app', 'browser'] }));
    const secrets = new MemorySecretBox();
    for (const key of ['openai_api_key', 'oauth:old-app:tokens', 'oauth:old-app:client', 'oauthapp:old-app', 'token:old-app', 'oauth:browser:tokens']) secrets.set(key, 'x');

    const log = new Logger(dir);
    const integrations = new Integrations(
      stateFile,
      { integrations: config.integrations as never, templates: config.templates as never },
      secrets,
      new McpOAuth(secrets, async () => undefined, log),
      log,
      () => ({ command: 'node', env: {} }),
    );

    expect(secrets.keys().sort()).toEqual(['oauth:browser:tokens', 'openai_api_key']);
    expect(integrations.list().find((i) => i.id === 'browser')?.enabled).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
