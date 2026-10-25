import fs from 'node:fs';
import { readJson, writeFileAtomic } from './store';

/** Where API keys and sign-in tokens are kept. */
export interface SecretBox {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  /** Names of everything saved (never the values). */
  keys(): string[];
}

/**
 * Encrypts each value with the given functions (the desktop app passes the
 * OS keychain via Electron safeStorage) and keeps the ciphertext in one file.
 * Without an encryptor (headless server) values are stored as-is in a file
 * only the current user can read.
 */
export class FileSecretBox implements SecretBox {
  private data: Record<string, string>;

  constructor(
    private file: string,
    private encrypt: (plain: string) => string = (s) => s,
    private decrypt: (stored: string) => string = (s) => s,
  ) {
    this.data = readJson<Record<string, string>>(file, {});
  }

  get(key: string) {
    const stored = this.data[key];
    if (stored === undefined) return undefined;
    try {
      return this.decrypt(stored);
    } catch {
      return undefined;
    }
  }

  set(key: string, value: string) {
    this.data[key] = this.encrypt(value);
    this.save();
  }

  delete(key: string) {
    delete this.data[key];
    this.save();
  }

  keys() {
    return Object.keys(this.data);
  }

  private save() {
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2));
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      // chmod is a no-op on Windows.
    }
  }
}

/** In-memory secrets, for tests. */
export class MemorySecretBox implements SecretBox {
  private data = new Map<string, string>();
  get(key: string) { return this.data.get(key); }
  set(key: string, value: string) { this.data.set(key, value); }
  delete(key: string) { this.data.delete(key); }
  keys() { return [...this.data.keys()]; }
}
