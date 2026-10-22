import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel } from '../shared/types';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "2026-10-22 23:41:05.123" in local time. */
export function formatTimestamp(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatLogLine(entry: LogEntry) {
  const level = entry.level.toUpperCase().padEnd(5);
  const data = entry.data ? `  ${entry.data}` : '';
  return `${formatTimestamp(entry.at)}  ${level} [${entry.source}] ${entry.message}${data}`;
}

/** Turn anything into a short single-line string for the log. */
export function summarize(value: unknown, max = 400): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = (text ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const SECRET_KEYS = /(^key$|api[_-]?key|token|secret|password|passwd|authorization|cookie|credential|private[_-]?key)/i;

const SECRET_VALUES: [RegExp, string][] = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-••••'],
  [/\bsk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g, 'sk-••••'],
  [/\b(xox[abposr]-|xapp-)[A-Za-z0-9-]{10,}/g, '$1••••'],
  [/\b(ghp_|gho_|ghu_|ghs_|github_pat_)[A-Za-z0-9_]{16,}/g, '$1••••'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza••••'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ••••'],
  [/([?&](?:access_token|token|key|api_key|apikey|code|client_secret)=)[^&\s"]+/gi, '$1••••'],
];

/** Hide anything that looks like a key or token inside a piece of text. */
export function scrub(text: string) {
  return SECRET_VALUES.reduce((out, [re, replacement]) => out.replace(re, replacement), text);
}

/** Replace secret-looking values before anything reaches the log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '••••' : redact(v);
    return out;
  }
  if (typeof value === 'string') return scrub(value);
  return value;
}

/**
 * The activity log behind the Logs tab. Every part of the app writes here; each
 * entry is kept in memory for the UI, pushed live to listeners, and appended to
 * FrogsWorld/logs/YYYY-MM-DD.log.
 */
export class Logger {
  private seq = 0;
  private buffer: LogEntry[] = [];
  private listeners = new Set<(entry: LogEntry) => void>();

  constructor(private logsDir: string | null, private capacity = 5000) {}

  onEntry(listener: (entry: LogEntry) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  log(level: LogLevel, source: string, message: string, data?: unknown) {
    const entry: LogEntry = {
      seq: ++this.seq,
      at: Date.now(),
      level,
      source,
      message: scrub(message),
      data: data === undefined ? undefined : summarize(redact(data)),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
    if (this.logsDir) {
      try {
        const d = new Date(entry.at);
        const file = path.join(this.logsDir, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
        fs.appendFileSync(file, formatLogLine(entry) + '\n');
      } catch {
        // Logging must never crash the app.
      }
    }
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  debug(source: string, message: string, data?: unknown) { return this.log('debug', source, message, data); }
  info(source: string, message: string, data?: unknown) { return this.log('info', source, message, data); }
  warn(source: string, message: string, data?: unknown) { return this.log('warn', source, message, data); }
  error(source: string, message: string, data?: unknown) { return this.log('error', source, message, data); }

  recent(limit = 2000) {
    return this.buffer.slice(-limit);
  }

  clear() {
    this.buffer = [];
  }
}
