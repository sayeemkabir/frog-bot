import os from 'node:os';
import path from 'node:path';
import { FrogPaths } from './paths';

export interface PermissionContext {
  /** The agent's own folder; writing inside it is always fine. */
  agentDir: string;
  /** Folders the agent may write to without asking (agent dir, shared dir). */
  writableDirs: string[];
  /** Folders nobody reads without asking (Frog Bot's own state and engine data). */
  protectedDirs?: string[];
  autonomy: 'ask' | 'auto';
  alwaysAllow: string[];
}

export interface Verdict {
  decision: 'allow' | 'ask';
  /** Sends something to other people (Slack, email, a public post). */
  outbound: boolean;
  /** Whether "Always allow" may be offered for this tool. */
  canAlwaysAllow: boolean;
  /** One line describing the action for the approval card and the log. */
  summary: string;
  reason: string;
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LSP', 'NotebookRead']);
const SAFE_TOOLS = new Set([
  'WebSearch', 'WebFetch', 'TodoWrite', 'ToolSearch',
  'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool',
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskStop', 'Agent', 'Skill',
]);

const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/** Words that always mean "this reaches other people". */
const SEND_VERBS = new Set(['send', 'publish', 'reply', 'tweet', 'broadcast', 'invite', 'notify', 'dm', 'forward', 'respond']);
/** Words that reach people when the tool is creating something ("add_comment", "create_post"). */
const SOCIAL_NOUNS = new Set(['post', 'comment', 'message', 'email', 'mail', 'share', 'schedule', 'reply', 'tweet', 'invite']);
const DELETE_VERBS = new Set(['delete', 'remove', 'archive', 'drop', 'purge', 'destroy', 'trash', 'revoke', 'erase', 'wipe', 'truncate', 'clear']);
const MUTATING_VERBS = new Set([
  'create', 'update', 'import', 'bulk', 'set', 'add', 'write', 'edit', 'move', 'upload', 'merge', 'close',
  'assign', 'refresh', 'submit', 'approve', 'reject', 'cancel', 'insert', 'patch', 'put', 'rename', 'complete', 'upsert',
  'execute', 'exec', 'run', 'resolve', 'download', 'export', 'save', 'apply', 'enable', 'disable', 'start', 'stop', 'trigger',
  'invoke', 'mark', 'transfer', 'pay', 'buy', 'install', 'deploy', 'modify', 'change', 'replace', 'restore', 'reset',
]);
const READ_VERBS = new Set([
  'list', 'get', 'search', 'read', 'fetch', 'preview', 'find', 'describe', 'view', 'status', 'whoami',
  'info', 'lookup', 'snapshot', 'count', 'check', 'inspect', 'pick', 'show', 'browse', 'summarize', 'validate',
]);

/** "slack_sendMessage" → ["slack", "send", "message"] */
export function toolTokens(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * What an app tool does, from the words in its name. Deleting and sending win
 * wherever they appear; a tool only counts as a read when it starts with a
 * read verb and changes nothing.
 */
export function toolIntent(name: string): 'read' | 'outbound' | 'delete' | 'mutate' | 'unknown' {
  const tokens = toolTokens(name);
  if (tokens.some((t) => DELETE_VERBS.has(t))) return 'delete';
  if (tokens.some((t) => SEND_VERBS.has(t))) return 'outbound';
  const first = tokens.find((t) => READ_VERBS.has(t) || MUTATING_VERBS.has(t));
  const mutates = tokens.some((t) => MUTATING_VERBS.has(t));
  if (first && READ_VERBS.has(first) && !mutates) return 'read';
  if (mutates && tokens.some((t) => SOCIAL_NOUNS.has(t))) return 'outbound';
  if (mutates) return 'mutate';
  return 'unknown';
}

const DESTRUCTIVE_SHELL = [
  /\brm\s+(-[a-z]*r|--recursive|-[a-z]*f)/i,
  /\b(rmdir|rd|ri|erase|del|remove-item|clear-content|clear-item)\b/i,
  /\bformat(-volume)?\b|\bmkfs|\bdiskpart\b|\bfdisk\b/i,
  /\bshutdown\b|\brestart-computer\b|\bstop-computer\b/i,
  /\bgit\s+(push\b.*(--force|-f\b)|reset\s+--hard|clean\s+-[a-z]*[fdx])/i,
  /\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b|\bdelete\s+from\b/i,
  /\breg\s+delete\b|\bset-executionpolicy\b|\bbcdedit\b/i,
  /\bchmod\s+-r\b|\bchown\s+-r\b/i,
  /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|]*\|\s*(sh|bash|iex|invoke-expression|powershell)/i,
];

/** Files whose contents are keys, passwords or tokens: reading them always asks. */
const SENSITIVE_FILE = /(^|[\\/])(\.env(\.[^\\/]*)?|[^\\/]*credential[^\\/]*|[^\\/]*\.pem|[^\\/]*\.key|id_rsa[^\\/]*|id_ed25519[^\\/]*|secrets\.json|\.npmrc|\.netrc|\.git-credentials|login data|cookies)$/i;
const SENSITIVE_DIRS = ['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.claude', '.config/gcloud'].map((d) => path.join(os.homedir(), d));
const BROWSER_PROFILE = /(google[\\/]chrome|microsoft[\\/]edge|bravesoftware|mozilla[\\/]firefox|browser-profile)[\\/]/i;

/** Browser tools that change a page (clicks, typing, forms, scripts). Everything else only looks. */
const BROWSER_ACTING = /(click|type|fill|press|select|drag|drop|upload|file|evaluate|run_code|dialog|install|mouse|keyboard|check)/i;

function splitMcpName(toolName: string) {
  // mcp__<server>__<tool>
  const parts = toolName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return null;
  return { server: parts[1], tool: parts.slice(2).join('__') };
}

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function pathFromInput(input: Record<string, unknown>) {
  const value = input.file_path ?? input.notebook_path ?? input.path;
  return typeof value === 'string' ? value : null;
}

/** True for files and folders that hold secrets or Frog Bot's own private state. */
export function isSensitivePath(target: string, protectedDirs: string[] = []) {
  const abs = path.resolve(target);
  if (SENSITIVE_FILE.test(abs) || BROWSER_PROFILE.test(abs + path.sep)) return true;
  return [...SENSITIVE_DIRS, ...protectedDirs].some((dir) => FrogPaths.isInside(dir, abs));
}

function commandTouchesSecrets(command: string) {
  return /(\.env\b|credential|secrets\.json|id_rsa|id_ed25519|\.ssh|\.aws|login data|\.git-credentials|frogsworld[\\/](state|engine))/i.test(command);
}

export function describeToolCall(toolName: string, rawInput: unknown): string {
  const input = asObject(rawInput);
  const mcp = splitMcpName(toolName);
  const file = pathFromInput(input);
  if (SHELL_TOOLS.has(toolName)) return `Run command: ${String(input.command ?? '').slice(0, 200)}`;
  if (FILE_WRITE_TOOLS.has(toolName) && file) return `${toolName === 'Write' ? 'Write' : 'Edit'} file: ${file}`;
  if (toolName === 'Read' && file) return `Read file: ${file}`;
  if ((toolName === 'Glob' || toolName === 'Grep') && file) return `Look through: ${file}`;
  if (toolName === 'WebSearch') return `Search the web: ${String(input.query ?? '')}`;
  if (toolName === 'WebFetch') return `Open web page: ${String(input.url ?? '')}`;
  if (mcp) {
    const args = Object.entries(input)
      .slice(0, 4)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v)?.slice(0, 60)}`)
      .join(', ');
    return `${mcp.server} → ${mcp.tool}${args ? ` (${args})` : ''}`;
  }
  return toolName;
}

/**
 * Decide whether an agent may run a tool on its own or must ask the user first.
 *
 * Looking things up never asks, except reading files that hold secrets.
 * Writing inside the agent's own folders never asks. Commands, changes
 * elsewhere, and changes in connected apps ask unless the agent works on its
 * own. Sending, posting and deleting always ask, unless the user chose
 * "always allow" for that exact app tool. Shell commands can never be
 * always-allowed, and destructive commands always ask.
 */
export function classifyTool(toolName: string, rawInput: unknown, ctx: PermissionContext): Verdict {
  const input = asObject(rawInput);
  const summary = describeToolCall(toolName, input);
  const isShell = SHELL_TOOLS.has(toolName);
  const allow = (reason: string, outbound = false): Verdict => ({ decision: 'allow', outbound, canAlwaysAllow: !isShell, summary, reason });
  const ask = (reason: string, outbound = false, canAlwaysAllow = !isShell): Verdict => ({ decision: 'ask', outbound, canAlwaysAllow, summary, reason });
  const protectedDirs = ctx.protectedDirs ?? [];
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.join(ctx.agentDir, p));

  if (READ_TOOLS.has(toolName)) {
    const file = pathFromInput(input);
    if (file && isSensitivePath(resolve(file), protectedDirs)) return ask('this file may hold passwords or keys', false, false);
    return allow('read-only');
  }

  if (isShell) {
    const command = String(input.command ?? '');
    if (DESTRUCTIVE_SHELL.some((re) => re.test(command))) return ask('command can delete or overwrite data', false, false);
    if (commandTouchesSecrets(command)) return ask('command touches files that may hold keys', false, false);
    return ctx.autonomy === 'auto' ? allow('autonomous mode: command') : ask('runs a command on this computer', false, false);
  }

  if (ctx.alwaysAllow.includes(toolName)) return allow('you chose "always allow" for this tool');

  if (SAFE_TOOLS.has(toolName)) return allow('read-only');

  const mcp = splitMcpName(toolName);

  // Frog's own coordination tools have their own UI (questions, agent requests).
  if (mcp?.server === 'frog') return allow('frog coordination tool');

  if (FILE_WRITE_TOOLS.has(toolName)) {
    const file = pathFromInput(input);
    if (file) {
      const abs = resolve(file);
      if (isSensitivePath(abs, protectedDirs)) return ask('this file may hold passwords or keys', false, false);
      if (ctx.writableDirs.some((dir) => FrogPaths.isInside(dir, abs))) return allow('inside the agent workspace');
    }
    return ctx.autonomy === 'auto' ? allow('autonomous mode: file change outside workspace') : ask('changes a file outside the agent workspace', false, false);
  }

  if (mcp) {
    const name = mcp.tool;
    if (mcp.server === 'browser') {
      if (!BROWSER_ACTING.test(name.replace(/^browser_/, ''))) return allow('browser: looking, not acting');
      return ctx.autonomy === 'auto' ? allow('autonomous mode: browser action') : ask('acts inside a web page');
    }
    switch (toolIntent(name)) {
      case 'read':
        return allow('reads from a connected app');
      case 'outbound':
        return ask('sends or publishes something on your behalf', true);
      case 'delete':
        return ask('deletes or removes data');
      case 'mutate':
        return ctx.autonomy === 'auto' ? allow('autonomous mode: change in a connected app') : ask('changes data in a connected app');
      default:
        return ctx.autonomy === 'auto' ? allow('autonomous mode') : ask('unknown tool');
    }
  }

  return ctx.autonomy === 'auto' ? allow('autonomous mode') : ask('not on the safe list');
}
