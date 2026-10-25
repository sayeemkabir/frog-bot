import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type {
  AddIntegrationInput,
  Agent,
  AgentRuntime,
  Conversation,
  EngineEvent,
  FileEntry,
  GroupMode,
  ID,
  IntegrationTemplate,
  Message,
  Mode,
  NewAgentInput,
  Provider,
  ScheduledTask,
  Settings,
  Snapshot,
} from '../shared/types';
import { createTeamServer, type TeamBridge } from './frogTools';
import { Integrations, type BuiltinIntegration, type NodeRuntime } from './integrations';
import { Logger, redact, scrub, summarize } from './logger';
import { findMentions } from './mentions';
import { McpOAuth } from './oauth';
import { FrogPaths, slugify } from './paths';
import { classifyTool, describeToolCall, isReadOnlyCall } from './permissions';
import { buildPersona, tailFile } from './persona';
import { ClaudeRunner, type TurnRunner, type TurnSink } from './runner';
import { OPENAI_MODEL_PREFERENCE, OpenAIRunner } from './openaiRunner';
import { openProfileWindow } from './agentBrowser';
import type { SecretBox } from './secrets';
import { JsonDoc, acquireLock, newId, onSaveError } from './store';

export interface AppConfig {
  workspaceName: string;
  defaultModel: string;
  models: { id: string; label: string }[];
  integrations: BuiltinIntegration[];
  templates: IntegrationTemplate[];
}

/** What the engine needs from whatever is hosting it (the desktop app or the server). */
export interface EngineHost {
  platform: string;
  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<void>;
  notify(title: string, body: string, conversationId?: string): void;
  nodeRuntime(): NodeRuntime;
  claudeExecutable?(): string | undefined;
  setStartAtLogin?(enabled: boolean): void;
  captureScreen?(): Promise<Buffer | null>;
}

export interface EngineOptions {
  paths: FrogPaths;
  config: AppConfig;
  secrets: SecretBox;
  host: EngineHost;
  logger?: Logger;
  runner?: TurnRunner;
  /** A key from the environment (.env) used when none is saved in the app. */
  envApiKey?: string;
  /** An OpenAI key from the environment, used when there is no Claude key. */
  envOpenAiKey?: string;
  /** Allow opening browser sign-ins on startup (off for tests and self-checks). */
  allowSignIn?: boolean;
}

interface StoredSettings {
  workspaceName: string;
  defaultModel: string;
  openaiModel?: string;
  startAtLogin: boolean;
  watchMode: { enabled: boolean; everyMinutes: number };
  tokenSaver?: boolean;
}

type TurnOrigin =
  | { kind: 'user' }
  | { kind: 'group' }
  | { kind: 'relay'; fromAgentId: ID; depth: number; mode?: Mode }
  | { kind: 'scheduled'; taskId: ID };

interface QueuedTurn {
  conversationId: ID;
  cancelled: boolean;
}

const API_KEY_SECRET = 'anthropic_api_key';
const OPENAI_KEY_SECRET = 'openai_api_key';
const MAX_RELAY_DEPTH = 6;
const MAX_MESSAGES_PER_TURN = 6;

/** Frog's job: the team's chief of staff (the working model of Grok Bot's Chief of Staff). */
const FROG_INSTRUCTIONS = `You are the chief of staff. The user talks to you; you run the team.
- Small or quick jobs: just do them yourself, fast.
- Bigger jobs: split them into parts and hand each part to the right teammate with message_agent, all in one go so they work at the same time. Say in one line who is doing what, then end your turn. You are woken up as answers come back.
- When the answers are in, combine them into one short brief for the user. End with "Needs your approval:" listing anything that spends money, sends or publishes for the user, or deletes, if there is any.
- Do not do a specialist's work yourself while they are on it, and do not chase them.
- If the team is missing a role the work needs, propose it with request_new_agent (name, one-line role, instructions).
- For work several teammates must discuss or decide together, use create_group and hand out the first steps with @Name.
- Keep the user informed in plain words.`;

/** Earlier default instructions, upgraded automatically to FROG_INSTRUCTIONS if the user never changed them. */
const OLD_FROG_INSTRUCTIONS = "You are the lead agent. Take the user's requests, break them into steps, do what you can yourself, and hand specialist work to teammates with message_agent. If the team is missing a role, use request_new_agent. Keep the user informed and ask before anything that speaks for them.";
/** How many @mention hand-offs a group discussion may chain before it pauses for the user. */
const MAX_GROUP_DEPTH = 12;
/** A message that only says thanks / got it, with no question and no new work. */
const ACKNOWLEDGEMENT = /^(thanks|thank you|thx|ty|got it|received|noted|great|perfect|awesome|ok(ay)?|sounds good|will do|understood|cheers|appreciate it|much appreciated)\b[^?]{0,300}$/i;
/** Words that turn a "thanks ..." into a real request, so it must still be answered. */
const REQUEST_CUE = /\b(please|pls|can you|could you|would you|will you|need you|need to|next|now|also|then|go ahead|todo|make sure|don'?t forget)\b/i;

/**
 * True for a message that only says thanks / got it, even with a short note
 * after it ("thanks, received. The file is saved at X"). Leading @mentions are
 * ignored. A question or a request in it means it is not an acknowledgement.
 */
export function isAcknowledgement(text: string): boolean {
  const body = text.trim().replace(/^(@\S+[\s,:-]*)+/, '').trim();
  return ACKNOWLEDGEMENT.test(body) && !REQUEST_CUE.test(body);
}
const ACTIVITY_LIMIT = 150;
const NO_REPLY = /^\(?\s*no reply\s*\)?\.?$/i;
const AGENT_COLORS = ['#3f9d6e', '#5b7fc9', '#8a6fc4', '#c48a4f', '#c45f6f', '#4a9aa5', '#8f9a4a', '#6b7280'];
const AGENT_EMOJIS = ['🐸', '🦊', '🐙', '🦉', '🐝', '🐳', '🦁', '🐼'];

export class FrogEngine {
  readonly log: Logger;
  readonly paths: FrogPaths;
  readonly integrations: Integrations;
  private oauth: McpOAuth;
  private customRunner?: TurnRunner;
  private claudeRunner: ClaudeRunner;
  private openaiRunner: OpenAIRunner;
  private openaiModels: string[] = [];
  private host: EngineHost;
  private config: AppConfig;
  private secrets: SecretBox;
  private envApiKey?: string;
  private envOpenAiKey?: string;
  private allowSignIn: boolean;

  private agentsDoc: JsonDoc<Agent[]>;
  private conversationsDoc: JsonDoc<Conversation[]>;
  private tasksDoc: JsonDoc<ScheduledTask[]>;
  private settingsDoc: JsonDoc<StoredSettings>;
  private messageDocs = new Map<ID, JsonDoc<Message[]>>();

  private runtimes = new Map<ID, AgentRuntime>();
  private queues = new Map<ID, Promise<void>>();
  private queued = new Map<ID, QueuedTurn[]>();
  private active = new Map<ID, { conversationId: ID; abort: AbortController }>();
  private waiters = new Map<ID, { conversationId: ID; resolve: (value: string) => void }>();
  private runningTasks = new Set<ID>();
  /** Messages waiting for a teammate who has not started on them yet (merged into one turn). */
  private pendingRelays = new Map<string, string[]>();
  /** Agents already queued to answer in a group (so several @mentions wake them once). */
  private pendingGroupTurns = new Set<string>();
  private listeners = new Set<(event: EngineEvent) => void>();
  private timers: NodeJS.Timeout[] = [];
  private releaseLock?: () => void;
  private watchTimer: NodeJS.Timeout | null = null;

  constructor(opts: EngineOptions) {
    this.paths = opts.paths;
    this.paths.ensure();
    this.config = opts.config;
    this.secrets = opts.secrets;
    this.host = opts.host;
    this.envApiKey = opts.envApiKey;
    this.envOpenAiKey = opts.envOpenAiKey;
    this.allowSignIn = opts.allowSignIn ?? true;
    this.log = opts.logger ?? new Logger(this.paths.logsDir);
    this.log.onEntry((entry) => this.emit({ type: 'log', entry }));

    const state = this.paths.stateDir;
    this.agentsDoc = new JsonDoc(path.join(state, 'agents.json'), []);
    this.conversationsDoc = new JsonDoc(path.join(state, 'conversations.json'), []);
    this.tasksDoc = new JsonDoc(path.join(state, 'tasks.json'), []);
    this.settingsDoc = new JsonDoc<StoredSettings>(path.join(state, 'settings.json'), {
      workspaceName: opts.config.workspaceName,
      defaultModel: opts.config.defaultModel,
      startAtLogin: false,
      watchMode: { enabled: false, everyMinutes: 10 },
    });

    this.oauth = new McpOAuth(this.secrets, (url) => this.host.openExternal(url), this.log);
    this.integrations = new Integrations(
      path.join(state, 'integrations.json'),
      { integrations: opts.config.integrations, templates: opts.config.templates },
      this.secrets,
      this.oauth,
      this.log,
      () => this.host.nodeRuntime(),
    );
    this.integrations.onChange(() =>
      this.emit({ type: 'integrations', integrations: this.integrations.list(), status: this.integrations.statuses() }),
    );

    this.customRunner = opts.runner;
    this.claudeRunner = new ClaudeRunner({
      apiKey: () => this.apiKey(),
      engineDir: this.paths.engineDir,
      executablePath: () => this.host.claudeExecutable?.(),
      log: this.log,
    });
    this.openaiRunner = new OpenAIRunner({
      apiKey: () => this.openAiKey(),
      sessionsDir: path.join(this.paths.engineDir, 'openai-sessions'),
      log: this.log,
    });

    for (const agent of this.agentsDoc.value) {
      this.paths.ensureAgent(agent.folder);
      this.runtimes.set(agent.id, { agentId: agent.id, status: 'idle', activity: [], costUsd: 0 });
    }
  }

  // ───────────────────────── lifecycle ─────────────────────────

  async start() {
    this.releaseLock = acquireLock(path.join(this.paths.stateDir, 'frogbot.lock'));
    onSaveError((file, err) => this.log.error('storage', `Could not save ${path.basename(file)} (will retry on the next change)`, String(err)));
    this.log.info('app', `Frog Bot started on ${this.host.platform}`, { home: this.paths.root });
    this.recoverInterrupted();
    if (this.agentsDoc.value.length === 0) this.seed();
    // Upgrade Frog to the chief-of-staff role unless the user wrote their own instructions.
    const frog = this.agentsDoc.value.find((a) => a.name === 'Frog' && a.instructions === OLD_FROG_INSTRUCTIONS);
    if (frog) this.updateAgent(frog.id, { instructions: FROG_INSTRUCTIONS, label: 'Chief of staff: plans the work and runs the team' });
    // Frog wears the Frog Bot mark unless the user picked something else.
    const plainFrog = this.agentsDoc.value.find((a) => a.name === 'Frog' && !a.avatarStyle);
    if (plainFrog) this.updateAgent(plainFrog.id, { avatarStyle: 'logo' });
    this.timers.push(setInterval(() => this.runDueTasks(), 30_000));
    this.applyWatchMode();
    this.refreshOpenAiModels().catch((err) => this.log.warn('openai', 'Model list failed', String(err)));
    this.connectIntegrationsOnStartup().catch((err) => this.log.error('integrations', 'Startup connect failed', String(err)));
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    for (const { abort } of this.active.values()) abort.abort();
    this.flush();
    void this.openaiRunner.dispose();
    this.log.info('app', 'Frog Bot stopped');
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  flush() {
    this.agentsDoc.flush();
    this.conversationsDoc.flush();
    this.tasksDoc.flush();
    this.settingsDoc.flush();
    for (const doc of this.messageDocs.values()) doc.flush();
  }

  onEvent(listener: (event: EngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must not stop the engine.
      }
    }
  }

  /** On a fresh install, start with one generalist agent. */
  private seed() {
    this.createAgent({
      name: 'Frog',
      label: 'Chief of staff: plans the work and runs the team',
      instructions: FROG_INSTRUCTIONS,
      avatarStyle: 'logo',
      emoji: '🐸',
      color: '#3ddc84',
    });
    this.log.info('app', 'Created the default agent "Frog"');
  }

  /** Questions and approvals from a previous run can no longer be answered. */
  private recoverInterrupted() {
    for (const conversation of this.conversationsDoc.value) {
      const doc = this.messagesDoc(conversation.id);
      let changed = false;
      for (const message of doc.value) {
        if (message.streaming) {
          message.streaming = false;
          changed = true;
        }
        if (message.kind === 'question' && message.question && !message.question.answer) {
          message.question.answer = '(expired: Frog Bot was restarted)';
          changed = true;
        }
        if (message.kind === 'approval' && message.approval && !message.approval.decision) {
          message.approval.decision = 'deny';
          changed = true;
        }
        if (message.kind === 'agent-request' && message.agentRequest && !message.agentRequest.decision) {
          message.agentRequest.decision = 'declined';
          changed = true;
        }
      }
      if (changed) doc.flush();
    }
  }

  private async connectIntegrationsOnStartup() {
    for (const integration of this.integrations.list()) {
      if (!integration.enabled || !integration.autoConnect) continue;
      // Open the browser sign-in automatically the very first time; after that
      // tokens refresh silently, and only an expired sign-in asks again.
      const firstTime = integration.auth === 'oauth' && !this.secrets.get(`oauth:${integration.id}:tokens`) && !this.secrets.get(`token:${integration.id}`);
      const status = await this.integrations.connect(integration.id, { interactive: firstTime && this.allowSignIn && Boolean(this.provider()) });
      if (status.state === 'needs-auth' && !firstTime) {
        this.host.notify(`${integration.name} needs you`, 'Sign-in expired. Open Integrations and click Connect.');
      }
    }
  }

  // ───────────────────────── settings & key ─────────────────────────

  apiKey() {
    return this.secrets.get(API_KEY_SECRET) || this.envApiKey || undefined;
  }

  openAiKey() {
    return this.secrets.get(OPENAI_KEY_SECRET) || this.envOpenAiKey || undefined;
  }

  /** Claude when there is a Claude key, otherwise OpenAI when there is an OpenAI key. */
  provider(): Provider | null {
    if (this.apiKey()) return 'anthropic';
    if (this.openAiKey()) return 'openai';
    return null;
  }

  private async refreshOpenAiModels() {
    if (!this.openAiKey()) return;
    this.openaiModels = await this.openaiRunner.availableModels();
    this.log.info('openai', `Models available: ${this.openaiModels.slice(0, 6).join(', ')}${this.openaiModels.length > 6 ? '…' : ''}`);
    this.emit({ type: 'settings', settings: this.settings() });
  }

  private defaultOpenAiModel() {
    const chosen = this.settingsDoc.value.openaiModel;
    if (chosen && (this.openaiModels.length === 0 || this.openaiModels.includes(chosen))) return chosen;
    return this.openaiModels[0] ?? OPENAI_MODEL_PREFERENCE[0];
  }

  /** The model an agent runs on with the current brain. */
  private modelFor(agent: Agent) {
    if (this.provider() !== 'openai') return /^claude/.test(agent.model) ? agent.model : this.settingsDoc.value.defaultModel;
    return /^claude/.test(agent.model) ? this.defaultOpenAiModel() : agent.model;
  }

  settings(): Settings {
    const s = this.settingsDoc.value;
    const provider = this.provider();
    const openaiModels = (this.openaiModels.length ? this.openaiModels : OPENAI_MODEL_PREFERENCE).map((id) => ({ id, label: id.toUpperCase().replace('GPT-', 'GPT-') }));
    return {
      workspaceName: s.workspaceName,
      defaultModel: provider === 'openai' ? this.defaultOpenAiModel() : s.defaultModel,
      models: provider === 'openai' ? openaiModels : this.config.models,
      startAtLogin: s.startAtLogin,
      watchMode: s.watchMode,
      tokenSaver: s.tokenSaver !== false,
      hasApiKey: Boolean(provider),
      hasClaudeKey: Boolean(this.apiKey()),
      hasOpenAiKey: Boolean(this.openAiKey()),
      provider,
      homeDir: this.paths.root,
    };
  }

  /** Save a Claude key (sk-ant-…) or an OpenAI key (sk-…). An empty value removes the current brain's key. */
  async setApiKey(key: string) {
    const trimmed = key.trim();
    if (!trimmed) {
      const which = this.provider() === 'openai' ? OPENAI_KEY_SECRET : API_KEY_SECRET;
      this.secrets.delete(which);
      this.log.info('settings', `${which === API_KEY_SECRET ? 'Claude' : 'OpenAI'} API key removed`);
    } else {
      if (trimmed.length < 20 || !/^sk-/.test(trimmed)) throw new Error('That does not look like a Claude (sk-ant-…) or OpenAI (sk-…) API key');
      if (trimmed.startsWith('sk-ant-')) {
        this.secrets.set(API_KEY_SECRET, trimmed);
        this.log.info('settings', 'Claude API key saved');
      } else {
        this.secrets.set(OPENAI_KEY_SECRET, trimmed);
        this.log.info('settings', 'OpenAI API key saved');
        this.openaiRunner = new OpenAIRunner({ apiKey: () => this.openAiKey(), sessionsDir: path.join(this.paths.engineDir, 'openai-sessions'), log: this.log });
        await this.refreshOpenAiModels();
      }
    }
    const settings = this.settings();
    this.emit({ type: 'settings', settings });
    if (settings.hasApiKey) this.connectIntegrationsOnStartup().catch(() => undefined);
    return settings;
  }

  async updateSettings(patch: Partial<Pick<Settings, 'workspaceName' | 'defaultModel' | 'startAtLogin' | 'watchMode' | 'tokenSaver'>>) {
    this.settingsDoc.update((s) => {
      if (patch.workspaceName !== undefined) s.workspaceName = patch.workspaceName.trim() || s.workspaceName;
      if (patch.defaultModel !== undefined) {
        if (/^claude/.test(patch.defaultModel)) s.defaultModel = patch.defaultModel;
        else s.openaiModel = patch.defaultModel;
      }
      if (patch.startAtLogin !== undefined) s.startAtLogin = patch.startAtLogin;
      if (patch.tokenSaver !== undefined) s.tokenSaver = patch.tokenSaver;
      if (patch.watchMode !== undefined) {
        s.watchMode = {
          enabled: patch.watchMode.enabled,
          everyMinutes: Math.min(120, Math.max(1, Math.round(patch.watchMode.everyMinutes || 10))),
        };
      }
    });
    this.settingsDoc.flush();
    if (patch.startAtLogin !== undefined) this.host.setStartAtLogin?.(patch.startAtLogin);
    if (patch.watchMode !== undefined) this.applyWatchMode();
    this.log.info('settings', 'Settings updated', patch);
    const settings = this.settings();
    this.emit({ type: 'settings', settings });
    return settings;
  }

  // ───────────────────────── snapshot & reads ─────────────────────────

  snapshot(): Snapshot {
    return {
      settings: this.settings(),
      agents: this.agentsDoc.value,
      conversations: this.conversationsDoc.value,
      runtimes: Object.fromEntries(this.runtimes),
      integrations: this.integrations.list(),
      integrationStatus: this.integrations.statuses(),
      templates: this.integrations.templates(),
      tasks: this.tasksDoc.value,
    };
  }

  messages(conversationId: ID): Message[] {
    if (!this.conversation(conversationId)) return [];
    return this.messagesDoc(conversationId).value;
  }

  private messagesDoc(conversationId: ID) {
    let doc = this.messageDocs.get(conversationId);
    if (!doc) {
      // Ids come from the UI; never let one turn into a path outside the messages folder.
      if (!/^c_[a-z0-9]+$/.test(conversationId) || !this.conversation(conversationId)) throw new Error('Conversation not found');
      doc = new JsonDoc<Message[]>(path.join(this.paths.messagesDir, `${conversationId}.json`), []);
      this.messageDocs.set(conversationId, doc);
    }
    return doc;
  }

  agent(id: ID) {
    return this.agentsDoc.value.find((a) => a.id === id);
  }

  conversation(id: ID) {
    return this.conversationsDoc.value.find((c) => c.id === id);
  }

  directConversation(agentId: ID) {
    return this.conversationsDoc.value.find((c) => c.kind === 'direct' && c.memberIds[0] === agentId);
  }

  private agentByName(name: string) {
    const wanted = name.trim().replace(/^@/, '').toLowerCase();
    const agents = this.agentsDoc.value;
    return agents.find((a) => a.name.toLowerCase() === wanted) ?? agents.find((a) => a.name.toLowerCase().startsWith(wanted));
  }

  // ───────────────────────── messages ─────────────────────────

  private addMessage(conversationId: ID, partial: Omit<Message, 'id' | 'conversationId' | 'createdAt'>): Message {
    const message: Message = { id: newId('m_'), conversationId, createdAt: Date.now(), ...partial };
    this.messagesDoc(conversationId).update((list) => list.push(message));
    this.touchConversation(conversationId, message);
    this.emit({ type: 'message:upsert', message });
    return message;
  }

  private updateMessage(conversationId: ID, messageId: ID, mutate: (message: Message) => void) {
    const doc = this.messagesDoc(conversationId);
    const message = doc.value.find((m) => m.id === messageId);
    if (!message) return undefined;
    doc.update(() => mutate(message));
    this.emit({ type: 'message:upsert', message });
    return message;
  }

  private removeMessage(conversationId: ID, messageId: ID) {
    this.messagesDoc(conversationId).update((list) => {
      const index = list.findIndex((m) => m.id === messageId);
      if (index !== -1) list.splice(index, 1);
    });
    this.emit({ type: 'message:remove', conversationId, messageId });
  }

  private touchConversation(conversationId: ID, message?: Message) {
    const conversation = this.conversation(conversationId);
    if (!conversation) return;
    this.conversationsDoc.update(() => {
      conversation.updatedAt = Date.now();
      if (message && message.text && !NO_REPLY.test(message.text.trim())) {
        const who = message.author.kind === 'agent' ? `${this.agent(message.author.agentId)?.name ?? 'Agent'}: ` : message.author.kind === 'user' ? 'You: ' : '';
        conversation.preview = `${who}${message.text}`.replace(/\s+/g, ' ').slice(0, 120);
      }
    });
    this.emit({ type: 'conversation:upsert', conversation });
  }

  async sendMessage(conversationId: ID, text: string) {
    const conversation = this.conversation(conversationId);
    if (!conversation) throw new Error('Conversation not found');
    const body = text.trim();
    if (!body) return;
    this.addMessage(conversationId, { author: { kind: 'user' }, kind: 'text', text: body });
    this.log.info(`chat:${conversation.title}`, 'You sent a message', body);

    if (conversation.kind === 'direct') {
      this.enqueueTurn(conversation.memberIds[0], conversationId, { kind: 'user' }, () => body);
      return;
    }
    const members = this.agentsDoc.value.filter((a) => conversation.memberIds.includes(a.id));
    const mentioned = findMentions(body, members);
    // No @mention: one agent owns the message (it can hand parts to teammates
    // with @Name), so nobody repeats the same work.
    const owner = mentioned.length ? null : this.groupOwner(members, conversationId);
    const targets = owner ? [owner] : mentioned;
    for (const agentId of targets) {
      this.enqueueTurn(agentId, conversationId, { kind: 'group' }, () => this.groupPrompt(agentId, conversationId));
    }
  }

  /**
   * Who answers a group message that names nobody: Frog (chief of staff) if
   * it is in the group, else whoever was addressed or spoke last, else the first member.
   */
  private groupOwner(members: Agent[], conversationId: ID): ID | null {
    if (!members.length) return null;
    const frog = members.find((a) => a.name === 'Frog');
    if (frog) return frog.id;
    const list = this.messages(conversationId);
    // The newest message is the one the user just sent, so look before it.
    for (let i = list.length - 2; i >= 0; i--) {
      const author = list[i].author;
      if (author.kind === 'agent') {
        const speaker = author.agentId;
        if (members.some((a) => a.id === speaker)) return speaker;
      } else if (author.kind === 'user') {
        const addressed = findMentions(list[i].text, members)[0];
        if (addressed) return addressed;
      }
    }
    return members[0].id;
  }

  /**
   * An agent wrote in a group and mentioned teammates as @Name: hand them the
   * next step there (Grok Bot's baton pass). Each mentioned teammate is queued
   * once, and long chains pause so the group cannot run away.
   */
  private handOffInGroup(from: Agent, conversationId: ID, text: string, depth: number, mode: Mode) {
    const group = this.conversation(conversationId);
    if (!group || group.kind !== 'group') return;
    const members = this.agentsDoc.value.filter((a) => group.memberIds.includes(a.id) && a.id !== from.id);
    const mentioned = findMentions(text, members);
    if (!mentioned.length) return;
    if (isAcknowledgement(text)) {
      // A "thanks, received" would wake the teammate for nothing.
      this.log.debug(`agent:${from.name}`, 'Skipped an acknowledgement hand-off in the group');
      return;
    }
    if (depth >= MAX_GROUP_DEPTH) {
      this.log.warn(`agent:${from.name}`, `Group "${group.title}" paused after ${MAX_GROUP_DEPTH} hand-offs`);
      this.addMessage(conversationId, { author: { kind: 'system' }, kind: 'text', text: `The team paused after ${MAX_GROUP_DEPTH} hand-offs. Reply to keep them going.` });
      return;
    }
    for (const agentId of mentioned) {
      const key = `${agentId}|${conversationId}`;
      if (this.pendingGroupTurns.has(key)) continue;
      this.pendingGroupTurns.add(key);
      this.enqueueTurn(agentId, conversationId, { kind: 'relay', fromAgentId: from.id, depth: depth + 1, mode }, () => {
        this.pendingGroupTurns.delete(key);
        return this.groupPrompt(agentId, conversationId);
      });
    }
  }

  /** Everything said in the group since this agent last spoke. */
  private groupPrompt(agentId: ID, conversationId: ID) {
    const conversation = this.conversation(conversationId);
    if (!conversation) return null;
    const list = this.messages(conversationId);
    // `seen` is the time of the newest message this agent has been shown. Times
    // stay correct when messages are removed, unlike list positions.
    const since = conversation.seen[agentId] ?? 0;
    const unseen = list.filter(
      (m) => m.createdAt > since && (m.kind === 'text' || m.kind === 'relay') && !m.streaming && !(m.author.kind === 'agent' && m.author.agentId === agentId),
    );
    this.conversationsDoc.update(() => {
      conversation.seen[agentId] = Math.max(since, ...list.map((m) => m.createdAt));
    });
    if (unseen.length === 0) return null;
    const lines = unseen.map((m) => `${this.authorName(m)}: ${m.text}`);
    return `[Group chat "${conversation.title}": new messages since you last spoke]\n${lines.join('\n')}\n\nReply as ${this.agent(agentId)?.name}.`;
  }

  private authorName(message: Message) {
    if (message.author.kind === 'user') return 'User';
    if (message.author.kind === 'agent') return this.agent(message.author.agentId)?.name ?? 'Agent';
    return 'System';
  }

  async stopConversation(conversationId: ID) {
    for (const turns of this.queued.values()) for (const turn of turns) if (turn.conversationId === conversationId) turn.cancelled = true;
    for (const [agentId, active] of this.active) {
      if (active.conversationId === conversationId) {
        active.abort.abort();
        this.log.info(`agent:${this.agent(agentId)?.name}`, 'Stopped by you');
      }
    }
    for (const [messageId, waiter] of this.waiters) {
      if (waiter.conversationId === conversationId) {
        waiter.resolve('__stopped__');
        this.waiters.delete(messageId);
      }
    }
    this.expireOpenCards(conversationId, '(stopped)');
  }

  /** Questions, approvals and agent requests nobody can answer any more stop being clickable. */
  private expireOpenCards(conversationId: ID, answer: string) {
    for (const message of this.messages(conversationId)) {
      if (this.waiters.has(message.id)) continue;
      if (message.kind === 'question' && message.question && !message.question.answer) {
        this.updateMessage(conversationId, message.id, (m) => (m.question!.answer = answer));
      } else if (message.kind === 'approval' && message.approval && !message.approval.decision) {
        this.updateMessage(conversationId, message.id, (m) => (m.approval!.decision = 'deny'));
      } else if (message.kind === 'agent-request' && message.agentRequest && !message.agentRequest.decision) {
        this.updateMessage(conversationId, message.id, (m) => (m.agentRequest!.decision = 'declined'));
      }
    }
  }

  // ───────────────────────── turns ─────────────────────────

  private enqueueTurn(agentId: ID, conversationId: ID, origin: TurnOrigin, buildPrompt: () => string | null) {
    const turn: QueuedTurn = { conversationId, cancelled: false };
    const list = this.queued.get(agentId) ?? [];
    list.push(turn);
    this.queued.set(agentId, list);
    const previous = this.queues.get(agentId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        const pending = this.queued.get(agentId) ?? [];
        pending.splice(pending.indexOf(turn), 1);
        if (turn.cancelled) return;
        await this.runTurn(agentId, conversationId, origin, buildPrompt);
      })
      .catch((err) => {
        this.log.error(`agent:${this.agent(agentId)?.name}`, 'Turn crashed', err instanceof Error ? err.stack : String(err));
      });
    this.queues.set(agentId, next);
    return next;
  }

  /** Wait until every queued turn has finished (used by tests and shutdown). */
  async idle() {
    let before: Promise<void>[];
    do {
      before = [...this.queues.values()];
      await Promise.all(before);
    } while ([...this.queues.values()].some((p, i) => p !== before[i]));
  }

  private setRuntime(agentId: ID, patch: Partial<AgentRuntime>) {
    const runtime = this.runtimes.get(agentId) ?? { agentId, status: 'idle' as const, activity: [], costUsd: 0 };
    Object.assign(runtime, patch);
    this.runtimes.set(agentId, runtime);
    this.emit({ type: 'runtime', runtime });
    return runtime;
  }

  private pushActivity(agentId: ID, kind: 'tool' | 'result' | 'thinking' | 'status', title: string, detail?: string) {
    const runtime = this.runtimes.get(agentId) ?? this.setRuntime(agentId, {});
    runtime.activity.push({ id: newId('a_'), agentId, at: Date.now(), kind, title, detail });
    if (runtime.activity.length > ACTIVITY_LIMIT) runtime.activity.splice(0, runtime.activity.length - ACTIVITY_LIMIT);
    this.emit({ type: 'runtime', runtime });
  }

  private async runTurn(agentId: ID, conversationId: ID, origin: TurnOrigin, buildPrompt: () => string | null) {
    const agent = this.agent(agentId);
    const conversation = this.conversation(conversationId);
    if (!agent || !conversation) return;
    const prompt = buildPrompt();
    if (!prompt) return;

    const source = `agent:${agent.name}`;
    const abort = new AbortController();
    this.active.set(agentId, { conversationId, abort });
    this.setRuntime(agentId, { status: 'working', currentTask: conversation.title, conversationId, waitingOn: undefined });
    this.pushActivity(agentId, 'status', `Started: ${summarize(prompt, 80)}`);
    this.log.info(source, `Turn started (${origin.kind}) in "${conversation.title}"`, prompt);

    const agentDir = this.paths.ensureAgent(agent.folder);
    const provider = this.provider();
    // Sessions are per brain: a Claude session id means nothing to OpenAI and vice versa.
    const sessionKey = provider === 'openai' ? `${agentId}:openai` : agentId;
    const depth = origin.kind === 'relay' ? origin.depth : 0;
    const turnMode = this.modeFor(agent, conversation, origin);
    let streamingId: ID | null = null;
    let lastError: string | undefined;

    const sink: TurnSink = {
      textDelta: (delta) => {
        if (!streamingId) {
          streamingId = this.addMessage(conversationId, { author: { kind: 'agent', agentId }, kind: 'text', text: delta, streaming: true }).id;
        } else {
          this.updateMessage(conversationId, streamingId, (m) => {
            m.text += delta;
          });
        }
      },
      textDone: (text) => {
        const finalText = text.trim();
        if (NO_REPLY.test(finalText)) {
          if (streamingId) this.removeMessage(conversationId, streamingId);
          this.log.debug(source, 'Chose not to reply');
        } else if (streamingId) {
          this.updateMessage(conversationId, streamingId, (m) => {
            m.text = finalText;
            m.streaming = false;
          });
          this.touchConversation(conversationId, this.messages(conversationId).find((m) => m.id === streamingId));
          this.log.info(source, 'Replied', finalText);
        } else {
          this.addMessage(conversationId, { author: { kind: 'agent', agentId }, kind: 'text', text: finalText });
          this.log.info(source, 'Replied', finalText);
        }
        if (!NO_REPLY.test(finalText)) this.handOffInGroup(agent, conversationId, finalText, depth, turnMode);
        streamingId = null;
      },
      tool: (_id, name, input) => {
        const title = describeToolCall(name, input);
        this.pushActivity(agentId, 'tool', title, summarize(redact(input), 600));
        this.log.info(source, `Tool → ${name}`, redact(input));
      },
      toolResult: (_id, text, isError, image) => {
        this.pushActivity(agentId, 'result', isError ? 'Tool failed' : 'Tool finished', summarize(scrub(text), 600));
        if (isError) this.log.warn(source, 'Tool error', text);
        else this.log.debug(source, 'Tool result', text);
        if (image && image.length < 3_000_000) this.setRuntime(agentId, { lastScreenshot: image });
      },
      session: (sessionId) => {
        if (conversation.sessions[sessionKey] !== sessionId) {
          this.conversationsDoc.update(() => {
            conversation.sessions[sessionKey] = sessionId;
          });
        }
      },
      done: ({ ok, costUsd, error, tokens }) => {
        const runtime = this.runtimes.get(agentId);
        this.setRuntime(agentId, {
          status: ok ? 'idle' : error === 'Stopped' ? 'idle' : 'error',
          currentTask: undefined,
          conversationId: undefined,
          waitingOn: undefined,
          costUsd: (runtime?.costUsd ?? 0) + (costUsd || 0),
          tokens: (runtime?.tokens ?? 0) + (tokens || 0),
        });
        this.pushActivity(agentId, 'status', ok ? 'Finished' : `Ended: ${error}`);
        if (ok) this.log.info(source, `Turn finished (${tokens ? `${tokens.toLocaleString()} tokens` : `$${(costUsd || 0).toFixed(4)}`})`);
        else {
          lastError = error;
          this.log.error(source, 'Turn failed', error);
        }
      },
    };

    try {
      const team = this.agentsDoc.value;
      const saver = this.settingsDoc.value.tokenSaver !== false;
      const persona = buildPersona({
        agent,
        team,
        conversation,
        workspaceName: this.settingsDoc.value.workspaceName,
        agentDir,
        sharedDir: this.paths.sharedDir,
        observationsDir: this.paths.observationsDir,
        memory: tailFile(this.paths.agentMemoryFile(agent.folder), saver ? 3000 : 8000),
        teamMemory: tailFile(this.paths.teamMemoryFile, saver ? 2000 : 6000),
        platform: this.host.platform,
        mode: this.modeFor(agent, conversation, origin),
      });
      const servers = await this.integrations.serversFor(agent.integrations, {
        slug: agent.folder,
        browserProfile: this.paths.agentBrowserProfile(agent.folder),
      });
      const mcpServers = { ...servers, frog: createTeamServer(this.teamBridge(agent, conversationId, depth, abort.signal, this.modeFor(agent, conversation, origin))) };

      const runner = this.customRunner ?? (provider === 'openai' ? this.openaiRunner : this.claudeRunner);
      const resume = conversation.sessions[sessionKey];
      await runner.run(
        {
          agentId,
          agentName: agent.name,
          model: this.modelFor(agent),
          cwd: agentDir,
          additionalDirectories: [this.paths.sharedDir],
          prompt,
          sessionId: resume,
          systemPromptAppend: persona,
          mcpServers,
          canUseTool: this.permissionGate(agent, conversationId, abort.signal, origin),
          fast: this.modeFor(agent, conversation, origin) === 'auto',
          saver,
          abort,
        },
        sink,
      );
      if (lastError && resume && /session|conversation.*not found|no conversation/i.test(lastError)) {
        // The saved session is gone (engine folder cleared); start fresh next time.
        this.conversationsDoc.update(() => {
          delete conversation.sessions[sessionKey];
        });
      }
      if (lastError && lastError !== 'Stopped') {
        this.addMessage(conversationId, { author: { kind: 'system' }, kind: 'error', text: `${agent.name} hit a problem: ${lastError}` });
        this.host.notify(`${agent.name} hit a problem`, summarize(lastError, 140), conversationId);
      } else if (!lastError && origin.kind !== 'user') {
        this.emit({ type: 'notify', title: `${agent.name} finished`, body: conversation.title, conversationId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(source, 'Turn crashed', err instanceof Error ? err.stack : message);
      this.setRuntime(agentId, { status: 'error', currentTask: undefined });
      this.addMessage(conversationId, { author: { kind: 'system' }, kind: 'error', text: `${agent.name} hit a problem: ${message}` });
    } finally {
      this.active.delete(agentId);
      const after = this.runtimes.get(agentId);
      if (after?.status === 'working' || after?.status === 'waiting') this.setRuntime(agentId, { status: 'idle', currentTask: undefined, conversationId: undefined, waitingOn: undefined });
    }
  }

  // ───────────────────────── approvals & questions ─────────────────────────

  private waitFor(messageId: ID, conversationId: ID, signal: AbortSignal) {
    return new Promise<string>((resolve) => {
      if (signal.aborted) return resolve('__stopped__');
      const onAbort = () => {
        this.waiters.delete(messageId);
        resolve('__stopped__');
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(messageId, {
        conversationId,
        resolve: (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
      });
    });
  }

  /**
   * Open the agent's browser profile in a normal window so the user can sign in
   * to a site (or finish a 2FA step). The agent's own browser is closed first,
   * because one profile can only be open in one window at a time.
   */
  async openAgentBrowser(agentId: ID, url?: string) {
    const agent = this.agent(agentId);
    if (!agent) throw new Error('Agent not found');
    if (this.active.has(agentId)) throw new Error(`${agent.name} is using its browser right now. Use the window it has open, or stop the task first.`);
    await this.openaiRunner.release(agentId);
    const raw = url?.trim();
    const target = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : undefined;
    openProfileWindow(this.paths.agentBrowserProfile(agent.folder), target);
    this.log.info(`agent:${agent.name}`, 'Opened the agent browser for you to sign in', target ? new URL(target).host : undefined);
  }

  /**
   * The mode an agent works in: a hand-off keeps the mode of the chat the work
   * started in (so an Auto job stays Auto across teammates); otherwise the
   * group's mode, or the agent's own.
   */
  modeFor(agent: Agent, conversation?: Conversation, origin?: TurnOrigin): Mode {
    if (origin?.kind === 'relay' && origin.mode) return origin.mode;
    if (conversation?.kind === 'group' && conversation.mode && conversation.mode !== 'each') return conversation.mode;
    return agent.autonomy ?? 'ask';
  }

  /** Change a chat's mode. In an agent's own chat that changes the agent; in a group, the group. */
  async setMode(conversationId: ID, mode: GroupMode) {
    const conversation = this.conversation(conversationId);
    if (!conversation) throw new Error('Conversation not found');
    if (conversation.kind === 'direct') {
      if (mode === 'each') throw new Error('Pick Ask, Auto or Plan');
      this.updateAgent(conversation.memberIds[0], { autonomy: mode });
    } else {
      this.conversationsDoc.update(() => {
        conversation.mode = mode;
      });
      this.conversationsDoc.flush();
      this.emit({ type: 'conversation:upsert', conversation });
    }
    this.log.info(`chat:${conversation.title}`, `Mode set to ${mode}`);
  }

  private permissionGate(agent: Agent, conversationId: ID, signal: AbortSignal, origin?: TurnOrigin): CanUseTool {
    return async (toolName, input) => {
      const current = this.agent(agent.id) ?? agent;
      // Read the mode on every call, so switching modes takes effect mid-task.
      const mode = this.modeFor(current, this.conversation(conversationId), origin);
      const source = `agent:${current.name}`;
      if (mode === 'plan' && !isReadOnlyCall(toolName, input)) {
        this.log.info(source, `Plan mode: held back ${toolName}`);
        return {
          behavior: 'deny',
          message: 'Plan mode is on: do not change anything yet. Finish looking around, then present a short numbered plan and tell the user to switch to Auto or Ask to carry it out.',
        };
      }
      const verdict = classifyTool(toolName, input, {
        agentDir: this.paths.agentDir(current.folder),
        writableDirs: [this.paths.agentDir(current.folder), this.paths.sharedDir],
        protectedDirs: [this.paths.stateDir, this.paths.engineDir],
        autonomy: mode === 'auto' ? 'auto' : 'ask',
        alwaysAllow: current.alwaysAllow,
      });
      if (verdict.decision === 'allow') {
        this.log.debug(source, `Allowed ${toolName} (${verdict.reason})`);
        return { behavior: 'allow', updatedInput: input };
      }

      this.log.info(source, `Asking you: ${verdict.summary}`, { reason: verdict.reason });
      const message = this.addMessage(conversationId, {
        author: { kind: 'agent', agentId: current.id },
        kind: 'approval',
        text: verdict.summary,
        approval: {
          tool: toolName,
          summary: `${verdict.summary}\n\nWhy it asks: ${verdict.reason}`,
          input: redact(input),
          canAlwaysAllow: verdict.canAlwaysAllow,
        },
      });
      this.setRuntime(current.id, {
        status: 'waiting',
        waitingOn: { conversationId, messageId: message.id, kind: 'approval', text: verdict.summary, canAlwaysAllow: verdict.canAlwaysAllow },
      });
      this.host.notify(`${current.name} needs your OK`, verdict.summary, conversationId);
      const decision = await this.waitFor(message.id, conversationId, signal);
      this.setRuntime(current.id, { status: 'working', waitingOn: undefined });

      if (decision === 'allow' || decision === 'always') {
        if (decision === 'always' && verdict.canAlwaysAllow) {
          this.updateAgent(current.id, { alwaysAllow: [...new Set([...current.alwaysAllow, toolName])] });
        }
        this.log.info(source, `You approved ${toolName}${decision === 'always' ? ' (always)' : ''}`);
        return { behavior: 'allow', updatedInput: input };
      }
      if (decision === '__stopped__') {
        this.updateMessage(conversationId, message.id, (m) => {
          if (m.approval) m.approval.decision = 'deny';
        });
        return { behavior: 'deny', message: 'The user stopped this task.', interrupt: true };
      }
      this.log.info(source, `You denied ${toolName}`);
      return { behavior: 'deny', message: 'The user said no to this action. Do not try it another way; ask what they would like instead.' };
    };
  }

  async decideApproval(messageId: ID, decision: 'allow' | 'always' | 'deny') {
    const waiter = this.waiters.get(messageId);
    if (waiter) {
      this.updateMessage(waiter.conversationId, messageId, (m) => {
        if (m.approval) m.approval.decision = decision;
      });
      this.waiters.delete(messageId);
      waiter.resolve(decision);
    }
  }

  async answerQuestion(messageId: ID, answer: string) {
    const waiter = this.waiters.get(messageId);
    if (!waiter) return;
    this.updateMessage(waiter.conversationId, messageId, (m) => {
      if (m.question) m.question.answer = answer;
    });
    this.log.info('chat', 'You answered a question', answer);
    this.waiters.delete(messageId);
    waiter.resolve(answer);
  }

  async decideAgentRequest(messageId: ID, decision: 'approved' | 'declined') {
    const waiter = this.waiters.get(messageId);
    if (!waiter) return;
    this.updateMessage(waiter.conversationId, messageId, (m) => {
      if (m.agentRequest) m.agentRequest.decision = decision;
    });
    this.waiters.delete(messageId);
    waiter.resolve(decision);
  }

  // ───────────────────────── team tools ─────────────────────────

  private teamBridge(agent: Agent, conversationId: ID, depth: number, signal: AbortSignal, mode: Mode): TeamBridge {
    const source = `agent:${agent.name}`;
    let sentThisTurn = 0;
    return {
      listTeam: () =>
        this.agentsDoc.value
          .filter((a) => a.id !== agent.id)
          .map((a) => ({ name: a.name, label: a.label, status: this.runtimes.get(a.id)?.status ?? 'idle' })),

      messageAgent: async (to, message) => {
        const target = this.agentByName(to);
        if (!target) return `No agent named "${to}". Team: ${this.agentsDoc.value.map((a) => a.name).join(', ')}`;
        if (target.id === agent.id) return 'That is you. Pick a teammate.';
        if (isAcknowledgement(message)) {
          // A "thanks" would wake the teammate for nothing (and invite a "you're welcome").
          this.log.debug(source, `Skipped an acknowledgement to ${target.name}`);
          return 'Not sent: no need to acknowledge. If the work is done, report the result to whoever asked you and end your turn.';
        }
        if (depth >= MAX_RELAY_DEPTH) {
          this.log.warn(source, `Relay to ${target.name} blocked: too many hand-offs in a row`);
          return 'Not delivered: this chain of hand-offs is too long. Summarize for the user and ask how to continue.';
        }
        if (++sentThisTurn > MAX_MESSAGES_PER_TURN) {
          this.log.warn(source, `Relay to ${target.name} blocked: more than ${MAX_MESSAGES_PER_TURN} messages in one turn`);
          return `Not delivered: you already sent ${MAX_MESSAGES_PER_TURN} messages this turn. Wait for replies.`;
        }
        // In a group both agents belong to, the hand-off happens right there, in
        // front of the user. Otherwise it goes to the teammate's own chat.
        const here = this.conversation(conversationId);
        const inGroup = here?.kind === 'group' && here.memberIds.includes(target.id);
        const destination = inGroup ? here : this.directConversation(target.id);
        if (!destination) return `${target.name} has no thread.`;
        const relay = { author: { kind: 'agent' as const, agentId: agent.id }, kind: 'relay' as const, text: message, relay: { fromAgentId: agent.id, toAgentId: target.id } };
        this.addMessage(conversationId, relay);
        if (destination.id !== conversationId) this.addMessage(destination.id, relay);
        this.log.info(source, `Messaged ${target.name}${inGroup ? ` in "${here!.title}"` : ''}`, message);
        const where = inGroup ? `in the group chat "${here!.title}"` : 'in your own chat';
        if (inGroup) {
          // Group turns read new messages since they last spoke; mark this one seen so it is not repeated.
          this.conversationsDoc.update(() => {
            destination.seen[target.id] = Math.max(destination.seen[target.id] ?? 0, Date.now());
          });
        }
        // If this teammate already has a message from this agent waiting, add to it
        // instead of waking them up once per message.
        const pendingKey = `${target.id}|${destination.id}|${agent.id}`;
        const pending = this.pendingRelays.get(pendingKey);
        if (pending) {
          pending.push(message);
          return `Added to your earlier message to ${target.name}; they will get both together. End your turn now; you will be woken up when they answer.`;
        }
        this.pendingRelays.set(pendingKey, [message]);
        this.enqueueTurn(target.id, destination.id, { kind: 'relay', fromAgentId: agent.id, depth: depth + 1, mode }, () => {
          const messages = this.pendingRelays.get(pendingKey) ?? [message];
          this.pendingRelays.delete(pendingKey);
          return `[Message from your teammate ${agent.name}${agent.label ? ` (${agent.label})` : ''}, ${where}]\n${messages.join('\n\n')}\n\nDo what is asked, fully. Then send the result to ${agent.name} with message_agent in one message. What you write here is shown to the user.`;
        });
        return inGroup
          ? `Delivered to ${target.name} here in the group. Their answer will appear in this chat. End your turn now; you will be woken up when they answer.`
          : `Delivered to ${target.name}. End your turn now: you will be woken up automatically when they answer. Do not check in or redo their work meanwhile.`;
      },

      createGroup: async (name, memberNames, message) => {
        const found = memberNames.map((n) => this.agentByName(n));
        const missing = memberNames.filter((_, i) => !found[i]);
        if (missing.length) return `No agent named ${missing.map((m) => `"${m}"`).join(', ')}. Team: ${this.agentsDoc.value.map((a) => a.name).join(', ')}`;
        const ids = [...new Set([agent.id, ...found.map((a) => a!.id)])];
        if (ids.length < 2) return 'A group needs at least one teammate besides you.';
        const group = this.createGroup(name.trim() || `${agent.name}'s group`, ids);
        this.conversationsDoc.update(() => {
          group.mode = mode;
        });
        this.log.info(source, `Created the group "${group.title}"`, found.map((a) => a!.name).join(', '));
        this.addMessage(group.id, { author: { kind: 'agent', agentId: agent.id }, kind: 'text', text: message });
        this.handOffInGroup(agent, group.id, message, depth, mode);
        return `Created "${group.title}" with ${found.map((a) => a!.name).join(', ')} and posted your message. Teammates you mentioned with @Name start now; the discussion continues there.`;
      },

      askUser: async (question, options) => {
        const message = this.addMessage(conversationId, {
          author: { kind: 'agent', agentId: agent.id },
          kind: 'question',
          text: question,
          question: { question, options },
        });
        this.setRuntime(agent.id, { status: 'waiting', waitingOn: { conversationId, messageId: message.id, kind: 'question', text: question, options } });
        this.host.notify(`${agent.name} has a question`, question, conversationId);
        this.log.info(source, 'Asked you', { question, options });
        const answer = await this.waitFor(message.id, conversationId, signal);
        this.setRuntime(agent.id, { status: 'working', waitingOn: undefined });
        return answer === '__stopped__' ? '(the user stopped this task)' : answer;
      },

      requestAgent: async (input) => {
        const message = this.addMessage(conversationId, {
          author: { kind: 'agent', agentId: agent.id },
          kind: 'agent-request',
          text: `I'd like a new teammate: ${input.name}`,
          agentRequest: { ...input },
        });
        this.setRuntime(agent.id, { status: 'waiting', waitingOn: { conversationId, messageId: message.id, kind: 'agent-request', text: `Add a new teammate: ${input.name}` } });
        this.host.notify(`${agent.name} wants a new teammate`, `${input.name}: ${input.reason}`, conversationId);
        this.log.info(source, `Requested a new agent "${input.name}"`, input.reason);
        const decision = await this.waitFor(message.id, conversationId, signal);
        this.setRuntime(agent.id, { status: 'working', waitingOn: undefined });
        if (decision !== 'approved') return 'The user declined. Carry on with the current team.';
        try {
          const { agent: created } = this.createAgent({
            name: input.name,
            label: input.label,
            instructions: input.instructions,
            section: agent.section,
          });
          return `Approved. ${created.name} is on the team now; use message_agent to give them work.`;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.updateMessage(conversationId, message.id, (m) => (m.agentRequest!.decision = 'declined'));
          this.addMessage(conversationId, { author: { kind: 'system' }, kind: 'error', text: `Could not add ${input.name}: ${reason}` });
          return `The user approved, but the agent could not be created: ${reason}`;
        }
      },

      notifyUser: (title, body) => {
        this.log.info(source, `Notification: ${title}`, body);
        this.host.notify(title, body, conversationId);
        this.emit({ type: 'notify', title, body, conversationId });
      },

      remember: (note, scope) => {
        const file = scope === 'team' ? this.paths.teamMemoryFile : this.paths.agentMemoryFile(agent.folder);
        const date = new Date().toISOString().slice(0, 10);
        fs.appendFileSync(file, `- [${date}]${scope === 'team' ? ` (${agent.name})` : ''} ${note.trim()}\n`);
        this.log.info(source, `Remembered (${scope})`, note);
        return `Saved to ${scope === 'team' ? 'team' : 'your'} memory.`;
      },

      scheduleTask: (prompt, everyMinutes) => {
        const task: ScheduledTask = {
          id: newId('t_'),
          agentId: agent.id,
          prompt,
          everyMinutes,
          nextRunAt: Date.now() + everyMinutes * 60_000,
          createdAt: Date.now(),
        };
        this.tasksDoc.update((tasks) => tasks.push(task));
        this.tasksDoc.flush();
        this.emit({ type: 'tasks', tasks: this.tasksDoc.value });
        this.log.info(source, `Scheduled a task every ${everyMinutes} min`, prompt);
        return `Scheduled (id ${task.id}). It runs every ${everyMinutes} minutes while Frog Bot is running.`;
      },

      listTasks: () => {
        const mine = this.tasksDoc.value.filter((t) => t.agentId === agent.id);
        return mine.length ? mine.map((t) => `${t.id}: every ${t.everyMinutes} min: ${t.prompt}`).join('\n') : 'No scheduled tasks.';
      },

      cancelTask: (taskId) => {
        const task = this.tasksDoc.value.find((t) => t.id === taskId && t.agentId === agent.id);
        if (!task) return `No task ${taskId}.`;
        this.deleteTask(taskId);
        return `Cancelled ${taskId}.`;
      },

      recentObservations: (count) => {
        const files = listObservationFiles(this.paths.observationsDir).slice(0, count);
        if (!this.settingsDoc.value.watchMode.enabled && files.length === 0) return 'Watch mode is off, so there are no screenshots. The user can turn it on in Settings.';
        return files.length ? files.join('\n') : 'No screenshots yet.';
      },
    };
  }

  // ───────────────────────── agents & groups ─────────────────────────

  createAgent(input: NewAgentInput) {
    const name = input.name.trim();
    if (!name) throw new Error('Give the agent a name');
    if (this.agentsDoc.value.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already an agent named "${name}"`);
    const index = this.agentsDoc.value.length;
    const folder = this.uniqueFolder(slugify(name));
    const agent: Agent = {
      id: newId('ag_'),
      name,
      folder,
      label: input.label?.trim() ?? '',
      instructions: input.instructions?.trim() ?? '',
      emoji: input.emoji || AGENT_EMOJIS[index % AGENT_EMOJIS.length],
      color: input.color || AGENT_COLORS[index % AGENT_COLORS.length],
      ...(input.avatarStyle ? { avatarStyle: input.avatarStyle } : {}),
      ...(input.avatarImage ? { avatarImage: input.avatarImage.slice(0, 400_000) } : {}),
      model: input.model || this.settingsDoc.value.defaultModel,
      integrations: input.integrations ?? this.integrations.list().filter((i) => i.enabled).map((i) => i.id),
      autonomy: input.autonomy ?? 'ask',
      alwaysAllow: [],
      section: input.section?.trim() || 'Agents',
      createdAt: Date.now(),
    };
    this.paths.ensureAgent(folder);
    this.agentsDoc.update((list) => list.push(agent));
    this.agentsDoc.flush();
    this.runtimes.set(agent.id, { agentId: agent.id, status: 'idle', activity: [], costUsd: 0 });
    const conversation: Conversation = {
      id: newId('c_'),
      kind: 'direct',
      title: agent.name,
      memberIds: [agent.id],
      sessions: {},
      seen: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preview: agent.label,
    };
    this.conversationsDoc.update((list) => list.push(conversation));
    this.conversationsDoc.flush();
    this.emit({ type: 'agent:upsert', agent });
    this.emit({ type: 'runtime', runtime: this.runtimes.get(agent.id)! });
    this.emit({ type: 'conversation:upsert', conversation });
    this.log.info('team', `Agent created: ${agent.name}`, { label: agent.label, model: agent.model, folder });
    return { agent, conversation };
  }

  private uniqueFolder(base: string) {
    const taken = new Set(this.agentsDoc.value.map((a) => a.folder));
    let folder = base;
    for (let n = 2; taken.has(folder); n++) folder = `${base}-${n}`;
    return folder;
  }

  updateAgent(agentId: ID, patch: Partial<Agent>) {
    const agent = this.agent(agentId);
    if (!agent) throw new Error('Agent not found');
    const { id: _id, folder: _folder, createdAt: _createdAt, ...allowed } = patch;
    if (allowed.avatarImage && allowed.avatarImage.length > 400_000) throw new Error('That picture is too large. Choose a smaller one.');
    if (allowed.name !== undefined) {
      const name = allowed.name.trim();
      if (!name) throw new Error('Name cannot be empty');
      if (this.agentsDoc.value.some((a) => a.id !== agentId && a.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already an agent named "${name}"`);
      allowed.name = name;
    }
    this.agentsDoc.update(() => Object.assign(agent, allowed));
    this.agentsDoc.flush();
    if (allowed.name) {
      const direct = this.directConversation(agentId);
      if (direct) {
        this.conversationsDoc.update(() => {
          direct.title = allowed.name!;
        });
        this.emit({ type: 'conversation:upsert', conversation: direct });
      }
    }
    this.emit({ type: 'agent:upsert', agent });
    this.log.info('team', `Agent updated: ${agent.name}`, Object.keys(allowed));
    return agent;
  }

  deleteAgent(agentId: ID) {
    const agent = this.agent(agentId);
    if (!agent) return;
    const direct = this.directConversation(agentId);
    if (direct) this.stopConversation(direct.id);
    this.active.get(agentId)?.abort.abort();
    this.agentsDoc.update((list) => list.splice(list.indexOf(agent), 1));
    this.agentsDoc.flush();
    if (direct) this.removeConversation(direct.id);
    for (const conversation of this.conversationsDoc.value.filter((c) => c.kind === 'group' && c.memberIds.includes(agentId))) {
      this.conversationsDoc.update(() => {
        conversation.memberIds = conversation.memberIds.filter((m) => m !== agentId);
      });
      this.emit({ type: 'conversation:upsert', conversation });
    }
    this.tasksDoc.update((tasks) => {
      for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].agentId === agentId) tasks.splice(i, 1);
    });
    this.emit({ type: 'tasks', tasks: this.tasksDoc.value });
    this.runtimes.delete(agentId);
    this.emit({ type: 'agent:remove', agentId });
    this.log.info('team', `Agent removed: ${agent.name} (files kept in ${this.paths.agentDir(agent.folder)})`);
  }

  createGroup(title: string, memberIds: ID[]) {
    const members = memberIds.filter((id) => this.agent(id));
    if (!title.trim()) throw new Error('Give the group a name');
    if (members.length === 0) throw new Error('Add at least one agent');
    const conversation: Conversation = {
      id: newId('c_'),
      kind: 'group',
      title: title.trim(),
      memberIds: members,
      sessions: {},
      seen: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preview: `${members.length} member${members.length === 1 ? "" : "s"}`,
    };
    this.conversationsDoc.update((list) => list.push(conversation));
    this.conversationsDoc.flush();
    this.emit({ type: 'conversation:upsert', conversation });
    this.log.info('team', `Group created: ${conversation.title}`, members.map((id) => this.agent(id)?.name));
    return conversation;
  }

  updateGroup(conversationId: ID, patch: { title?: string; memberIds?: ID[] }) {
    const conversation = this.conversation(conversationId);
    if (!conversation || conversation.kind !== 'group') throw new Error('Group not found');
    this.conversationsDoc.update(() => {
      if (patch.title?.trim()) conversation.title = patch.title.trim();
      if (patch.memberIds) conversation.memberIds = patch.memberIds.filter((id) => this.agent(id));
    });
    this.conversationsDoc.flush();
    this.emit({ type: 'conversation:upsert', conversation });
    this.log.info('team', `Group updated: ${conversation.title}`);
    return conversation;
  }

  deleteConversation(conversationId: ID) {
    const conversation = this.conversation(conversationId);
    if (!conversation) return;
    if (conversation.kind === 'direct') throw new Error('Remove the agent to remove its thread');
    this.stopConversation(conversationId);
    this.removeConversation(conversationId);
    this.log.info('team', `Group removed: ${conversation.title}`);
  }

  private removeConversation(conversationId: ID) {
    this.conversationsDoc.update((list) => {
      const index = list.findIndex((c) => c.id === conversationId);
      if (index !== -1) list.splice(index, 1);
    });
    this.conversationsDoc.flush();
    this.messageDocs.get(conversationId)?.flush();
    this.messageDocs.delete(conversationId);
    try {
      fs.rmSync(path.join(this.paths.messagesDir, `${conversationId}.json`), { force: true });
    } catch {
      // Already gone.
    }
    this.emit({ type: 'conversation:remove', conversationId });
  }

  // ───────────────────────── integrations ─────────────────────────

  addIntegration(input: AddIntegrationInput) {
    const integration = this.integrations.add(input);
    // Give it to every agent by default; they can be switched off per agent.
    for (const agent of this.agentsDoc.value) {
      if (!agent.integrations.includes(integration.id)) this.updateAgent(agent.id, { integrations: [...agent.integrations, integration.id] });
    }
    if (integration.auth !== 'none') this.integrations.connect(integration.id).catch(() => undefined);
    return integration;
  }

  // ───────────────────────── tasks & watch mode ─────────────────────────

  deleteTask(taskId: ID) {
    this.tasksDoc.update((tasks) => {
      const index = tasks.findIndex((t) => t.id === taskId);
      if (index !== -1) tasks.splice(index, 1);
    });
    this.tasksDoc.flush();
    this.emit({ type: 'tasks', tasks: this.tasksDoc.value });
    this.log.info('scheduler', `Task removed: ${taskId}`);
  }

  runDueTasks(now = Date.now()) {
    for (const task of this.tasksDoc.value) {
      if (task.nextRunAt > now) continue;
      this.tasksDoc.update(() => {
        task.nextRunAt = now + task.everyMinutes * 60_000;
      });
      const agent = this.agent(task.agentId);
      const direct = agent && this.directConversation(agent.id);
      if (!agent || !direct) continue;
      if (this.runningTasks.has(task.id)) {
        // The last run is still queued or waiting on you; don't pile up more.
        this.log.debug('scheduler', `Skipped ${task.id}: previous run not finished`);
        continue;
      }
      this.runningTasks.add(task.id);
      this.log.info('scheduler', `Running scheduled task for ${agent.name}`, task.prompt);
      this.enqueueTurn(agent.id, direct.id, { kind: 'scheduled', taskId: task.id }, () => `[Scheduled task ${task.id}, runs every ${task.everyMinutes} min]\n${task.prompt}`)
        .finally(() => this.runningTasks.delete(task.id));
    }
  }

  private applyWatchMode() {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    const { enabled, everyMinutes } = this.settingsDoc.value.watchMode;
    if (!enabled || !this.host.captureScreen) return;
    this.log.info('watch', `Watch mode on: a screenshot every ${everyMinutes} min`);
    this.watchTimer = setInterval(() => this.captureObservation(), everyMinutes * 60_000);
  }

  async captureObservation() {
    const png = await this.host.captureScreen?.();
    if (!png) return null;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const dir = path.join(this.paths.observationsDir, day);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${now.toTimeString().slice(0, 8).replace(/:/g, '')}.png`);
    fs.writeFileSync(file, png);
    this.log.info('watch', 'Saved a screenshot', file);
    pruneObservations(this.paths.observationsDir, 300);
    return file;
  }

  // ───────────────────────── files & logs ─────────────────────────

  listFiles(agentId: ID, subPath = ''): FileEntry[] {
    const agent = this.agent(agentId);
    if (!agent) throw new Error('Agent not found');
    const base = this.paths.agentDir(agent.folder);
    const target = path.resolve(base, subPath);
    if (!FrogPaths.isInside(base, target)) throw new Error('Outside the agent folder');
    if (!fs.existsSync(target)) return [];
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((d) => d.name !== 'browser-profile' && !d.name.startsWith('.'))
      .map((d) => {
        const full = path.join(target, d.name);
        const stat = fs.statSync(full);
        return { name: d.name, path: full, isDir: d.isDirectory(), size: stat.size, modifiedAt: stat.mtimeMs };
      })
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  }

  logs(limit = 2000) {
    return this.log.recent(limit);
  }

  clearLogs() {
    this.log.clear();
    this.log.info('logs', 'Log view cleared (files on disk are kept)');
  }
}

function listObservationFiles(dir: string) {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const day of fs.readdirSync(dir).sort().reverse()) {
    const dayDir = path.join(dir, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const file of fs.readdirSync(dayDir).sort().reverse()) files.push(path.join(dayDir, file));
  }
  return files;
}

function pruneObservations(dir: string, keep: number) {
  const files = listObservationFiles(dir);
  for (const file of files.slice(keep)) fs.rmSync(file, { force: true });
}

export function defaultPlatformName() {
  return { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform as string] ?? os.platform();
}
