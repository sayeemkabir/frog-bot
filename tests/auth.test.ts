import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountManager, type AccountSession, type AuthBackend } from '../src/core/auth';

const dirs: string[] = [];
function tempBase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-auth-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A sign-in service in memory. `online` false makes every call fail like a dropped connection. */
class FakeBackend implements AuthBackend {
  users = new Map<string, { id: string; password: string; name: string }>();
  online = true;
  revoked = new Set<string>();
  private n = 0;

  private session(email: string): AccountSession {
    const u = this.users.get(email)!;
    return { user: { id: u.id, email, name: u.name }, accessToken: `a${++this.n}`, refreshToken: `${email}|r${this.n}`, expiresAt: Date.now() + 3600_000 };
  }
  private check() {
    if (!this.online) throw new Error('Could not reach the sign-in service. Check your internet connection.');
  }
  async signUp(email: string, password: string, name: string) {
    this.check();
    if (this.users.has(email)) throw new Error('There is already an account with this email. Sign in instead.');
    this.users.set(email, { id: `user-${this.users.size + 1}`, password, name });
    return this.session(email);
  }
  async signIn(email: string, password: string) {
    this.check();
    if (this.users.get(email)?.password !== password) throw new Error('That email and password do not match an account.');
    return this.session(email);
  }
  async refresh(token: string) {
    this.check();
    if (this.revoked.has(token)) throw new Error('Invalid Refresh Token');
    return this.session(token.split('|')[0]);
  }
  async signOut() {}
  async updateName() {}
}

const plain = { seal: (s: string) => `sealed:${s}`, open: (s: string) => s.replace(/^sealed:/, '') };

describe('accounts', () => {
  it('runs without accounts when no sign-in service is set up', async () => {
    const manager = new AccountManager(tempBase(), null, plain);
    expect(await manager.restore()).toEqual({ required: false, user: null });
    expect(manager.rootFor(undefined)).toBe(manager.rootFor());
  });

  it('checks the email and the 6-character minimum, and nothing more', async () => {
    const manager = new AccountManager(tempBase(), new FakeBackend(), plain);
    await expect(manager.signUp('not-an-email', 'secret1', 'Sam')).rejects.toThrow(/email/);
    await expect(manager.signUp('sam@example.com', '12345', 'Sam')).rejects.toThrow(/6 characters/);
    const status = await manager.signUp('Sam@Example.com ', 'abcdef', 'Sam');
    expect(status.user).toMatchObject({ email: 'sam@example.com', profile: { name: 'Sam', avatarStyle: 'initials' } });
  });

  it('gives each account its own team folder and keeps the session sealed', async () => {
    const base = tempBase();
    const backend = new FakeBackend();
    const a = new AccountManager(base, backend, plain);
    await a.signUp('a@example.com', 'pass-a1', 'A');
    const rootA = a.rootFor(a.user!.id);
    await a.signOut();
    await a.signUp('b@example.com', 'pass-b1', 'B');
    expect(a.rootFor(a.user!.id)).not.toBe(rootA);
    expect(fs.readFileSync(path.join(base, 'app', 'session.dat'), 'utf8')).toMatch(/^sealed:/);
  });

  it('reopens signed in, also with no internet, and signs out a revoked session', async () => {
    const base = tempBase();
    const backend = new FakeBackend();
    await new AccountManager(base, backend, plain).signUp('c@example.com', 'secret', 'C');

    expect((await new AccountManager(base, backend, plain).restore()).user?.email).toBe('c@example.com');

    backend.online = false;
    const offline = await new AccountManager(base, backend, plain).restore();
    expect(offline).toMatchObject({ offline: true, user: { email: 'c@example.com' } });

    backend.online = true;
    const saved = JSON.parse(plain.open(fs.readFileSync(path.join(base, 'app', 'session.dat'), 'utf8')));
    backend.revoked.add(saved.refreshToken);
    expect((await new AccountManager(base, backend, plain).restore()).user).toBeNull();
  });

  it('hands the team from before accounts to the first account only', async () => {
    const base = tempBase();
    fs.mkdirSync(path.join(base, 'state'), { recursive: true });
    fs.writeFileSync(path.join(base, 'state', 'agents.json'), '[]');
    fs.mkdirSync(path.join(base, 'agents', 'frog'), { recursive: true });

    const manager = new AccountManager(base, new FakeBackend(), plain);
    await manager.signUp('first@example.com', 'secret', 'First');
    const root = manager.rootFor(manager.user!.id);
    expect(fs.existsSync(path.join(root, 'state', 'agents.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'agents', 'frog'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'state'))).toBe(false);

    await manager.signOut();
    await manager.signUp('second@example.com', 'secret', 'Second');
    expect(fs.existsSync(path.join(manager.rootFor(manager.user!.id), 'state'))).toBe(false);
  });

  it('saves the profile picture and name on this computer', async () => {
    const manager = new AccountManager(tempBase(), new FakeBackend(), plain);
    await manager.signUp('d@example.com', 'secret', 'Dee');
    const status = await manager.updateProfile({ avatarStyle: 'emoji', emoji: '🦊', name: 'Dee Dee' });
    expect(status.user?.profile).toMatchObject({ avatarStyle: 'emoji', emoji: '🦊', name: 'Dee Dee' });
    await expect(manager.updateProfile({ avatarImage: 'x'.repeat(400_001) })).rejects.toThrow(/too large/);
  });
});
