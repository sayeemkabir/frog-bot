// Types shared by the engine (Node) and the UI (browser). Keep this file free of
// Node or DOM imports so both sides can use it.

export type ID = string;

/** How freely agents act. ask: asks before changing things. auto: acts on its own, only asks before sending, deleting or touching secrets. plan: only looks and plans, changes nothing. */
export type Mode = 'ask' | 'auto' | 'plan';
/** A group can follow each agent's own mode, or set one mode for everyone in it. */
export type GroupMode = Mode | 'each';

export interface Agent {
  id: ID;
  name: string;
  /** Folder name under FrogsWorld/agents. */
  folder: string;
  /** Short role line shown under the name, e.g. "Reddit strategist". */
  label: string;
  /** Standing instructions: who this agent is and how it should work. */
  instructions: string;
  emoji: string;
  color: string;
  model: string;
  /** Integration ids this agent may use. */
  integrations: ID[];
  /** The agent's own mode (used in its own chat, and in groups set to "each"). */
  autonomy: Mode;
  /** Tool names the user said "always allow" for this agent. */
  alwaysAllow: string[];
  section: string;
  createdAt: number;
}

export type ConversationKind = 'direct' | 'group';

export interface Conversation {
  id: ID;
  kind: ConversationKind;
  title: string;
  /** For direct: exactly one agent. For group: every member. */
  memberIds: ID[];
  /** Claude session id per agent, so each agent remembers this thread. */
  sessions: Record<ID, string>;
  /** Index of the last message each agent has already seen (groups). */
  seen: Record<ID, number>;
  /** Groups only: one mode for everyone here, or each agent's own. */
  mode?: GroupMode;
  createdAt: number;
  updatedAt: number;
  preview: string;
}

export type Author =
  | { kind: 'user' }
  | { kind: 'agent'; agentId: ID }
  | { kind: 'system' };

export type MessageKind =
  | 'text'
  | 'question'
  | 'approval'
  | 'agent-request'
  | 'relay'
  | 'error';

export interface QuestionPayload {
  question: string;
  options: string[];
  answer?: string;
}

export interface ApprovalPayload {
  tool: string;
  summary: string;
  input: unknown;
  /** False for actions that must be approved every time (commands, secrets, writes outside the workspace). */
  canAlwaysAllow?: boolean;
  decision?: 'allow' | 'always' | 'deny';
}

export interface AgentRequestPayload {
  name: string;
  label: string;
  instructions: string;
  reason: string;
  decision?: 'approved' | 'declined';
}

export interface RelayPayload {
  fromAgentId: ID;
  toAgentId: ID;
}

export interface Message {
  id: ID;
  conversationId: ID;
  author: Author;
  kind: MessageKind;
  text: string;
  createdAt: number;
  question?: QuestionPayload;
  approval?: ApprovalPayload;
  agentRequest?: AgentRequestPayload;
  relay?: RelayPayload;
  /** Still being streamed in. */
  streaming?: boolean;
}

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error';

export interface ActivityItem {
  id: ID;
  agentId: ID;
  at: number;
  kind: 'tool' | 'result' | 'thinking' | 'status';
  title: string;
  detail?: string;
}

export interface WaitingOn {
  conversationId: ID;
  messageId: ID;
  kind: 'approval' | 'question' | 'agent-request';
  text: string;
  options?: string[];
  canAlwaysAllow?: boolean;
}

export interface AgentRuntime {
  agentId: ID;
  status: AgentStatus;
  currentTask?: string;
  /** The chat the agent is working in right now. */
  conversationId?: ID;
  /** What the agent needs from the user right now, wherever it is. */
  waitingOn?: WaitingOn;
  activity: ActivityItem[];
  lastScreenshot?: string;
  costUsd: number;
  /** Tokens used this session (input + output). */
  tokens?: number;
}

export type IntegrationTransport = 'http' | 'sse' | 'stdio' | 'builtin-browser';
export type IntegrationAuth = 'oauth' | 'token' | 'none';

export interface IntegrationField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface IntegrationTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  transport: IntegrationTransport;
  url?: string;
  auth: IntegrationAuth;
  fields?: IntegrationField[];
  /** OAuth scopes to ask for when signing in. */
  scope?: string;
  /**
   * For servers without automatic client registration (like Slack): sign in
   * through the user's own registered app on this fixed local port, so the
   * redirect address can be registered once in that app.
   */
  oauthPort?: number;
  /** Short setup steps shown above the form. */
  help?: string;
  /** An app manifest the user pastes into the service to create their own app (copied by a button). */
  manifest?: unknown;
}

export interface Integration {
  id: ID;
  name: string;
  description: string;
  icon: string;
  transport: IntegrationTransport;
  url?: string;
  command?: string;
  args?: string[];
  auth: IntegrationAuth;
  scope?: string;
  oauthPort?: number;
  builtin?: boolean;
  autoConnect?: boolean;
  enabled: boolean;
}

export type IntegrationState = 'connected' | 'needs-auth' | 'connecting' | 'error' | 'disabled';

export interface IntegrationStatus {
  id: ID;
  state: IntegrationState;
  detail?: string;
  toolCount?: number;
}

export interface ScheduledTask {
  id: ID;
  agentId: ID;
  prompt: string;
  everyMinutes: number;
  nextRunAt: number;
  createdAt: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  seq: number;
  at: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: string;
}

export type Provider = 'anthropic' | 'openai';

export interface Settings {
  workspaceName: string;
  /** True when any brain (Claude or OpenAI) has a key. */
  hasApiKey: boolean;
  hasClaudeKey: boolean;
  hasOpenAiKey: boolean;
  /** Which brain agents use right now: Claude when it has a key, otherwise OpenAI. */
  provider: Provider | null;
  defaultModel: string;
  models: { id: string; label: string }[];
  startAtLogin: boolean;
  watchMode: { enabled: boolean; everyMinutes: number };
  /** Spend fewer tokens: load app tools only when needed, trim old tool output, lighter thinking. */
  tokenSaver: boolean;
  homeDir: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
}

/** Everything the UI needs on first paint. */
export interface Snapshot {
  settings: Settings;
  agents: Agent[];
  conversations: Conversation[];
  runtimes: Record<ID, AgentRuntime>;
  integrations: Integration[];
  integrationStatus: Record<ID, IntegrationStatus>;
  templates: IntegrationTemplate[];
  tasks: ScheduledTask[];
}

/** Events pushed from the engine to every connected UI. */
export type EngineEvent =
  | { type: 'agent:upsert'; agent: Agent }
  | { type: 'agent:remove'; agentId: ID }
  | { type: 'conversation:upsert'; conversation: Conversation }
  | { type: 'conversation:remove'; conversationId: ID }
  | { type: 'message:upsert'; message: Message }
  | { type: 'message:remove'; conversationId: ID; messageId: ID }
  | { type: 'runtime'; runtime: AgentRuntime }
  | { type: 'integrations'; integrations: Integration[]; status: Record<ID, IntegrationStatus> }
  | { type: 'tasks'; tasks: ScheduledTask[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'log'; entry: LogEntry }
  | { type: 'notify'; title: string; body: string; conversationId?: ID };

export interface NewAgentInput {
  name: string;
  label?: string;
  instructions?: string;
  emoji?: string;
  color?: string;
  model?: string;
  integrations?: ID[];
  autonomy?: Mode;
  section?: string;
}

export interface AddIntegrationInput {
  templateId: string;
  values: Record<string, string>;
}

/**
 * The request/response API the UI calls. The Electron preload and the
 * WebSocket server both implement exactly this, so the same UI works on the
 * desktop and against a hosted server.
 */
export interface FrogApi {
  snapshot(): Promise<Snapshot>;
  messages(conversationId: ID): Promise<Message[]>;
  sendMessage(conversationId: ID, text: string): Promise<void>;
  stopConversation(conversationId: ID): Promise<void>;
  createAgent(input: NewAgentInput): Promise<{ agent: Agent; conversation: Conversation }>;
  updateAgent(agentId: ID, patch: Partial<Agent>): Promise<Agent>;
  deleteAgent(agentId: ID): Promise<void>;
  createGroup(title: string, memberIds: ID[]): Promise<Conversation>;
  updateGroup(conversationId: ID, patch: { title?: string; memberIds?: ID[] }): Promise<Conversation>;
  /** Set the mode of a chat: an agent's own chat changes that agent; a group changes the group. */
  setMode(conversationId: ID, mode: GroupMode): Promise<void>;
  deleteConversation(conversationId: ID): Promise<void>;
  answerQuestion(messageId: ID, answer: string): Promise<void>;
  decideApproval(messageId: ID, decision: 'allow' | 'always' | 'deny'): Promise<void>;
  decideAgentRequest(messageId: ID, decision: 'approved' | 'declined'): Promise<void>;
  setApiKey(key: string): Promise<Settings>;
  updateSettings(patch: Partial<Pick<Settings, 'workspaceName' | 'defaultModel' | 'startAtLogin' | 'watchMode' | 'tokenSaver'>>): Promise<Settings>;
  addIntegration(input: AddIntegrationInput): Promise<Integration>;
  removeIntegration(id: ID): Promise<void>;
  setIntegrationEnabled(id: ID, enabled: boolean): Promise<void>;
  connectIntegration(id: ID): Promise<IntegrationStatus>;
  disconnectIntegration(id: ID): Promise<void>;
  listFiles(agentId: ID, subPath?: string): Promise<FileEntry[]>;
  openPath(path: string): Promise<void>;
  deleteTask(taskId: ID): Promise<void>;
  logs(limit?: number): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  openLogsFolder(): Promise<void>;
}

export type FrogApiMethod = keyof FrogApi;

export const FROG_API_METHODS: FrogApiMethod[] = [
  'snapshot',
  'messages',
  'sendMessage',
  'stopConversation',
  'createAgent',
  'updateAgent',
  'deleteAgent',
  'createGroup',
  'updateGroup',
  'setMode',
  'deleteConversation',
  'answerQuestion',
  'decideApproval',
  'decideAgentRequest',
  'setApiKey',
  'updateSettings',
  'addIntegration',
  'removeIntegration',
  'setIntegrationEnabled',
  'connectIntegration',
  'disconnectIntegration',
  'listFiles',
  'openPath',
  'deleteTask',
  'logs',
  'clearLogs',
  'openLogsFolder',
];
