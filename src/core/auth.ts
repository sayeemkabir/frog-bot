import fs from 'node:fs';
import path from 'node:path';
import type { AccountProfile, AuthStatus } from '../shared/types';
import { readJson, writeFileAtomic } from './store';

export type { AccountProfile, AuthStatus };

/** Who is signed in. Name and picture are kept on this computer with the account. */
export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

export interface AccountSession {
  user: AccountUser;
  accessToken: string;
  refreshToken: string;
  /** When the access token expires (ms). */
  expiresAt: number;
}

/** The sign-in service. Supabase in the app; a fake in tests. */
export interface AuthBackend {
  signUp(email: string, password: string, name: string): Promise<AccountSession>;
  signIn(email: string, password: string): Promise<AccountSession>;
  refresh(refreshToken: string): Promise<AccountSession>;
  signOut(accessToken: string): Promise<void>;
  updateName(accessToken: string, name: string): Promise<void>;
}

export interface SupabaseConfig {
  supabaseUrl: string;
  /** The public ("anon"/publishable) key. Safe to ship: the database rules protect the data. */
  supabaseAnonKey: string;
}

/** Plain-language versions of the sign-in service's error messages. */
function friendlyAuthError(status: number, body: Record<string, unknown>) {
  const raw = String(body.msg ?? body.error_description ?? body.message ?? body.error ?? `HTTP ${status}`);
  if (/invalid login credentials|invalid_grant/i.test(raw)) return 'That email and password do not match an account.';
  if (/already registered|already exists|user_already_exists/i.test(raw)) return 'There is already an account with this email. Sign in instead.';
  if (/password should be at least|weak_password/i.test(raw)) return 'Use a password with at least 6 characters.';
  if (/valid email|invalid.*email|email_address_invalid/i.test(raw)) return 'That does not look like an email address.';
  if (/rate limit|too many/i.test(raw)) return 'Too many tries. Wait a minute and try again.';
  if (/email not confirmed/i.test(raw)) return 'This account still needs its email confirmed.';
  return raw;
}

/** Supabase Auth over its plain HTTP API (no SDK needed). */
export class SupabaseAuth implements AuthBackend {
  constructor(private config: SupabaseConfig) {}

  private async call(route: string, init: { method?: string; body?: unknown; token?: string }) {
    let res: Response;
    try {
      res = await fetch(`${this.config.supabaseUrl.replace(/\/$/, '')}/auth/v1/${route}`, {
        method: init.method ?? 'POST',
        headers: {
          apikey: this.config.supabaseAnonKey,
          'content-type': 'application/json',
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('Could not reach the sign-in service. Check your internet connection.');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(friendlyAuthError(res.status, body));
    return body;
  }

  private toSession(body: Record<string, any>): AccountSession {
    if (!body.access_token) throw new Error('This account needs its email confirmed before signing in.');
    const user = body.user ?? {};
    return {
      user: { id: String(user.id), email: String(user.email ?? ''), name: String(user.user_metadata?.name ?? user.email?.split('@')[0] ?? '') },
      accessToken: String(body.access_token),
      refreshToken: String(body.refresh_token),
      expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    };
  }

  async signUp(email: string, password: string, name: string) {
    return this.toSession(await this.call('signup', { body: { email, password, data: { name } } }));
  }

  async signIn(email: string, password: string) {
    return this.toSession(await this.call('token?grant_type=password', { body: { email, password } }));
  }

  async refresh(refreshToken: string) {
    return this.toSession(await this.call('token?grant_type=refresh_token', { body: { refresh_token: refreshToken } }));
  }

  async signOut(accessToken: string) {
    await this.call('logout', { token: accessToken }).catch(() => undefined);
  }

  async updateName(accessToken: string, name: string) {
    await this.call('user', { method: 'PUT', token: accessToken, body: { data: { name } } });
  }
}

/** Folders that belong to a team; moved into the first account that signs in on this computer. */
const TEAM_ITEMS = ['agents', 'shared', 'logs', 'observations', 'state', 'engine'];

/**
 * Keeps the signed-in account on this computer. Each account gets its own
 * FrogsWorld/accounts/<id> folder with its own agents, chats, files and keys.
 * The session is stored encrypted (via `protect`), so the app reopens signed in,
 * even with no internet.
 */
export class AccountManager {
  private session: AccountSession | null = null;
  private offline = false;

  constructor(
    private base: string,
    private backend: AuthBackend | null,
    private protect: { seal: (plain: string) => string; open: (sealed: string) => string },
  ) {}

  get required() {
    return Boolean(this.backend);
  }

  private get sessionFile() {
    return path.join(this.base, 'app', 'session.dat');
  }

  /** Where this account's team lives. Without accounts, the team lives in FrogsWorld itself. */
  rootFor(userId?: string) {
    return userId ? path.join(this.base, 'accounts', userId) : this.base;
  }

  profileFile(userId: string) {
    return path.join(this.rootFor(userId), 'profile.json');
  }

  profile(user: AccountUser): AccountProfile {
    const saved = readJson<Partial<AccountProfile>>(this.profileFile(user.id), {});
    return {
      name: saved.name || user.name || user.email.split('@')[0],
      avatarStyle: saved.avatarStyle ?? 'initials',
      emoji: saved.emoji ?? '🙂',
      color: saved.color ?? '#5b7fc9',
      avatarImage: saved.avatarImage,
    };
  }

  status(): AuthStatus {
    if (!this.backend) return { required: false, user: null };
    if (!this.session) return { required: true, user: null };
    return { required: true, user: { ...this.session.user, profile: this.profile(this.session.user) }, offline: this.offline };
  }

  get user() {
    return this.session?.user ?? null;
  }

  /** Reopen the saved session. Refreshes it when online; keeps it when offline. */
  async restore() {
    if (!this.backend || !fs.existsSync(this.sessionFile)) return this.status();
    try {
      const saved = JSON.parse(this.protect.open(fs.readFileSync(this.sessionFile, 'utf8'))) as AccountSession;
      this.session = saved;
      try {
        this.session = await this.backend.refresh(saved.refreshToken);
        this.offline = false;
        this.save();
      } catch (err) {
        // Wrong or revoked session: sign out. No internet: stay signed in locally.
        if (/do not match|invalid|revoked|not found|expired/i.test(String(err))) this.clear();
        else this.offline = true;
      }
    } catch {
      this.clear();
    }
    return this.status();
  }

  async signUp(email: string, password: string, name: string) {
    if (!this.backend) throw new Error('Accounts are not set up yet.');
    const clean = this.validate(email, password);
    if (!name.trim()) throw new Error('Tell us your name.');
    return this.begin(await this.backend.signUp(clean, password, name.trim()));
  }

  async signIn(email: string, password: string) {
    if (!this.backend) throw new Error('Accounts are not set up yet.');
    return this.begin(await this.backend.signIn(this.validate(email, password), password));
  }

  async signOut() {
    const session = this.session;
    this.clear();
    if (session && this.backend) await this.backend.signOut(session.accessToken);
  }

  /** Save the user's name and picture (name also goes to the account). */
  async updateProfile(patch: Partial<AccountProfile>) {
    if (!this.session) throw new Error('Not signed in');
    const next = { ...this.profile(this.session.user), ...patch };
    if (next.avatarImage && next.avatarImage.length > 400_000) throw new Error('That picture is too large. Choose a smaller one.');
    fs.mkdirSync(path.dirname(this.profileFile(this.session.user.id)), { recursive: true });
    writeFileAtomic(this.profileFile(this.session.user.id), JSON.stringify(next, null, 2));
    if (patch.name && this.backend && !this.offline) {
      await this.backend.updateName(this.session.accessToken, patch.name).catch(() => undefined);
    }
    return this.status();
  }

  private validate(email: string, password: string) {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('That does not look like an email address.');
    if (password.length < 6) throw new Error('Use a password with at least 6 characters.');
    return clean;
  }

  private begin(session: AccountSession) {
    this.session = session;
    this.offline = false;
    this.adoptExistingTeam(session.user.id);
    this.save();
    return this.status();
  }

  /** The first account on a computer that already has a team (from before accounts) takes it over. */
  private adoptExistingTeam(userId: string) {
    const accounts = path.join(this.base, 'accounts');
    const hasLegacy = fs.existsSync(path.join(this.base, 'state', 'agents.json'));
    const anyAccount = fs.existsSync(accounts) && fs.readdirSync(accounts).length > 0;
    if (!hasLegacy || anyAccount) return;
    const target = this.rootFor(userId);
    fs.mkdirSync(target, { recursive: true });
    for (const item of TEAM_ITEMS) {
      const from = path.join(this.base, item);
      if (fs.existsSync(from)) fs.renameSync(from, path.join(target, item));
    }
  }

  private save() {
    if (!this.session) return;
    fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
    writeFileAtomic(this.sessionFile, this.protect.seal(JSON.stringify(this.session)));
  }

  private clear() {
    this.session = null;
    this.offline = false;
    fs.rmSync(this.sessionFile, { force: true });
  }
}
