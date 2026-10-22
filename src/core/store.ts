import fs from 'node:fs';
import path from 'node:path';

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Write a file atomically: write a temp file, then rename over the target.
 * On Windows the rename can briefly fail while antivirus or the search indexer
 * has the file open, so it retries a few times before giving up.
 */
export function writeFileAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      sleepSync(40 * (attempt + 1));
    }
  }
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Where failed background saves are reported (the engine points this at its log). */
export let reportSaveError: (file: string, err: unknown) => void = (file, err) => console.error(`Could not save ${file}:`, err);
export function onSaveError(handler: (file: string, err: unknown) => void) {
  reportSaveError = handler;
}

/**
 * A JSON document kept in memory and written to disk shortly after each change.
 * Writes are batched so a burst of streamed updates costs one disk write. A
 * failed write is reported and retried on the next change instead of crashing.
 */
export class JsonDoc<T> {
  private timer: NodeJS.Timeout | null = null;
  value: T;

  constructor(readonly file: string, fallback: T, private delayMs = 250) {
    this.value = readJson(file, fallback);
  }

  update(mutate: (value: T) => void) {
    mutate(this.value);
    this.schedule();
  }

  set(value: T) {
    this.value = value;
    this.schedule();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.write();
  }

  private write() {
    try {
      writeFileAtomic(this.file, JSON.stringify(this.value, null, 2));
    } catch (err) {
      reportSaveError(this.file, err);
    }
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.delayMs);
  }
}

export function newId(prefix = '') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

/**
 * Make sure only one Frog Bot (desktop app or server) uses a FrogsWorld folder
 * at a time; two would overwrite each other's state.
 */
export function acquireLock(lockFile: string): () => void {
  try {
    const pid = Number(fs.readFileSync(lockFile, 'utf8'));
    if (pid && pid !== process.pid) {
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (err) {
        alive = (err as NodeJS.ErrnoException).code === 'EPERM';
      }
      if (alive) throw new Error(`This FrogsWorld folder is already in use by another Frog Bot (process ${pid}). Close it first, or set FROG_HOME to a different folder.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, String(process.pid));
  return () => {
    try {
      if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.rmSync(lockFile, { force: true });
    } catch {
      // Already gone.
    }
  };
}
