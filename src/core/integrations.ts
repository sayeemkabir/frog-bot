import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type {
  AddIntegrationInput,
  Integration,
  IntegrationStatus,
  IntegrationTemplate,
} from '../shared/types';
import type { Logger } from './logger';
import type { McpOAuth } from './oauth';
import type { SecretBox } from './secrets';
import { JsonDoc, newId } from './store';
import { slugify } from './paths';

export interface BuiltinIntegration extends Omit<Integration, 'enabled'> {
  scope?: string;
}

export interface IntegrationConfig {
  integrations: BuiltinIntegration[];
  templates: IntegrationTemplate[];
}

/** How to start a Node script: Electron runs itself as Node, the server uses node. */
export interface NodeRuntime {
  command: string;
  env: Record<string, string>;
  /** Extra flags for the agents' browser. A server runs it headless in its own Chromium. */
  browserArgs?: string[];
}

/** Default OAuth scopes for servers that need them (templates can set their own). */
const OAUTH_SCOPES: Record<string, string> = {};

const requireHere = createRequire(import.meta.url);

function playwrightMcpCli() {
  const pkg = requireHere.resolve('@playwright/mcp/package.json');
  return path.join(path.dirname(pkg), 'cli.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

/**
 * Keeps the list of connected apps (MCP servers), their sign-in state, and
 * turns them into the MCP config each agent gets for a turn.
 */
export class Integrations {
  private userDoc: JsonDoc<{ added: Integration[]; disabled: string[] }>;
  private status = new Map<string, IntegrationStatus>();
  private listeners = new Set<() => void>();

  constructor(
    stateFile: string,
    private config: IntegrationConfig,
    private secrets: SecretBox,
    private oauth: McpOAuth,
    private log: Logger,
    private node: () => NodeRuntime,
  ) {
    this.userDoc = new JsonDoc(stateFile, { added: [], disabled: [] });
    for (const integration of this.list()) {
      this.status.set(integration.id, { id: integration.id, state: this.initialState(integration) });
    }
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  templates() {
    return this.config.templates;
  }

  list(): Integration[] {
    const disabled = new Set(this.userDoc.value.disabled);
    const builtins = this.config.integrations.map((i) => ({ ...i, enabled: !disabled.has(i.id) }));
    const added = this.userDoc.value.added.map((i) => ({ ...i, enabled: !disabled.has(i.id) }));
    return [...builtins, ...added];
  }

  get(id: string) {
    return this.list().find((i) => i.id === id);
  }

  statuses() {
    return Object.fromEntries(this.list().map((i) => [i.id, this.status.get(i.id) ?? { id: i.id, state: 'disabled' as const }]));
  }

  private initialState(integration: Integration): IntegrationStatus['state'] {
    if (!integration.enabled) return 'disabled';
    if (integration.auth === 'oauth' && !this.secrets.get(`token:${integration.id}`)) {
      return this.oauth.hasTokens(integration.id) ? 'connected' : 'needs-auth';
    }
    return 'connected';
  }

  private setStatus(status: IntegrationStatus) {
    this.status.set(status.id, status);
    this.log.info(`integration:${status.id}`, `Status: ${status.state}`, status.detail);
    this.changed();
  }

  add(input: AddIntegrationInput): Integration {
    const template = this.config.templates.find((t) => t.id === input.templateId);
    if (!template) throw new Error(`Unknown integration template: ${input.templateId}`);
    const values = input.values;
    const name = (values.name || template.name).trim();
    const id = this.uniqueId(slugify(name));
    const integration: Integration = {
      id,
      name,
      description: template.description,
      icon: template.icon,
      transport: template.transport,
      url: (values.url || template.url || '').trim() || undefined,
      command: values.command?.trim() || undefined,
      args: values.args ? splitArgs(values.args) : undefined,
      auth: values.token ? 'token' : template.auth,
      ...(template.scope ? { scope: template.scope } : {}),
      ...(template.oauthPort ? { oauthPort: template.oauthPort } : {}),
      enabled: true,
    };
    if ((integration.transport === 'http' || integration.transport === 'sse') && !integration.url) {
      throw new Error('A server URL is required');
    }
    if (integration.transport === 'stdio' && !integration.command) throw new Error('A command is required');
    if (integration.auth === 'oauth' && template.oauthPort && !values.clientId?.trim()) {
      throw new Error(`${template.name} needs your app's Client ID and Client Secret (see the steps above the form)`);
    }
    if (values.token) this.secrets.set(`token:${id}`, values.token.trim());
    if (values.clientId?.trim()) this.oauth.setOwnApp(id, values.clientId, values.clientSecret);
    this.userDoc.update((doc) => doc.added.push(integration));
    this.userDoc.flush();
    this.log.info(`integration:${id}`, 'Added', { name, transport: integration.transport, host: integration.url ? new URL(integration.url).host : integration.command });
    this.status.set(id, { id, state: integration.auth === 'oauth' ? 'needs-auth' : 'connected' });
    this.changed();
    return integration;
  }

  remove(id: string) {
    const integration = this.get(id);
    if (!integration) return;
    if (integration.builtin) throw new Error(`${integration.name} is built in; turn it off instead of removing it`);
    this.userDoc.update((doc) => {
      doc.added = doc.added.filter((i) => i.id !== id);
      doc.disabled = doc.disabled.filter((d) => d !== id);
    });
    this.userDoc.flush();
    this.secrets.delete(`token:${id}`);
    this.oauth.forget(id, true);
    this.status.delete(id);
    this.log.info(`integration:${id}`, 'Removed');
    this.changed();
  }

  setEnabled(id: string, enabled: boolean) {
    this.userDoc.update((doc) => {
      doc.disabled = doc.disabled.filter((d) => d !== id);
      if (!enabled) doc.disabled.push(id);
    });
    this.userDoc.flush();
    const integration = this.get(id);
    if (integration) this.setStatus({ id, state: enabled ? this.initialState(integration) : 'disabled' });
  }

  disconnect(id: string) {
    this.oauth.forget(id);
    this.secrets.delete(`token:${id}`);
    this.setStatus({ id, state: 'needs-auth', detail: 'Signed out' });
  }

  /** Sign in if needed, then check the server answers and count its tools. */
  async connect(id: string, { interactive = true } = {}): Promise<IntegrationStatus> {
    const integration = this.get(id);
    if (!integration) throw new Error(`Unknown integration: ${id}`);
    if (!integration.enabled) return this.status.get(id)!;
    if (integration.transport === 'builtin-browser' || integration.transport === 'stdio') {
      this.setStatus({ id, state: 'connected', detail: 'Starts when an agent needs it' });
      return this.status.get(id)!;
    }
    this.setStatus({ id, state: 'connecting' });
    try {
      let token = await this.bearer(integration);
      if (!token && integration.auth === 'oauth') {
        if (!interactive) {
          this.setStatus({ id, state: 'needs-auth', detail: 'Click Connect to sign in' });
          return this.status.get(id)!;
        }
        await this.oauth.signIn(id, integration.url!, this.signInOptions(integration));
        token = await this.bearer(integration);
      }
      const toolCount = await this.probe(integration, token);
      this.setStatus({ id, state: 'connected', toolCount, detail: `${toolCount} tools` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const needsAuth = /401|unauthori[sz]ed|sign-in|invalid_token/i.test(message);
      this.setStatus({ id, state: needsAuth ? 'needs-auth' : 'error', detail: message });
    }
    return this.status.get(id)!;
  }

  /** Connect everything marked autoConnect. Opens sign-in only when `interactive`. */
  async autoConnect(interactive: boolean) {
    for (const integration of this.list()) {
      if (integration.enabled && integration.autoConnect) await this.connect(integration.id, { interactive });
    }
  }

  private async bearer(integration: Integration) {
    const staticToken = this.secrets.get(`token:${integration.id}`);
    if (staticToken) return staticToken;
    if (integration.auth !== 'oauth' || !integration.url) return undefined;
    return this.oauth.accessToken(integration.id, integration.url, this.signInOptions(integration));
  }

  private signInOptions(integration: Integration) {
    return { scope: integration.scope ?? OAUTH_SCOPES[integration.id], port: integration.oauthPort };
  }

  private async probe(integration: Integration, token?: string) {
    const client = new Client({ name: 'frog-bot', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(integration.url!), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      return tools.length;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /**
   * The MCP servers an agent gets for one turn. Integrations that need a
   * sign-in that has not happened yet are left out (and logged) rather than
   * failing the turn.
   */
  async serversFor(integrationIds: string[], agent: { slug: string; browserProfile: string }) {
    const servers: Record<string, McpServerConfig> = {};
    for (const integration of this.list()) {
      if (!integration.enabled || !integrationIds.includes(integration.id)) continue;
      const name = integration.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (integration.transport === 'builtin-browser') {
        const node = this.node();
        servers.browser = {
          type: 'stdio',
          command: node.command,
          args: [playwrightMcpCli(), '--user-data-dir', agent.browserProfile, ...(node.browserArgs ?? [])],
          env: node.env,
        };
        continue;
      }
      if (integration.transport === 'stdio') {
        servers[name] = { type: 'stdio', command: integration.command!, args: integration.args ?? [] };
        continue;
      }
      const token = await this.bearer(integration);
      if (!token && integration.auth !== 'none') {
        this.log.warn(`integration:${integration.id}`, `Skipped for ${agent.slug}: not signed in`);
        if (this.status.get(integration.id)?.state !== 'needs-auth') {
          this.setStatus({ id: integration.id, state: 'needs-auth', detail: 'Sign-in expired; click Connect' });
        }
        continue;
      }
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      servers[name] = integration.transport === 'sse'
        ? { type: 'sse', url: integration.url!, headers }
        : { type: 'http', url: integration.url!, headers };
    }
    return servers;
  }

  private uniqueId(base: string) {
    const taken = new Set(this.list().map((i) => i.id));
    if (!taken.has(base) && base !== 'frog' && base !== 'browser') return base;
    return `${base}-${newId().slice(-4)}`;
  }
}

/** Split a command-line string into arguments, honouring simple quotes. */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}
