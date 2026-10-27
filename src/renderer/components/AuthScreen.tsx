import { useState } from 'react';
import type { AuthStatus } from '../../shared/types';
import { authApi } from '../api';
import { WelcomeLayout } from './ui';

/** Sign in or create an account. Each account has its own private team on this computer. */
export function AuthScreen({ onSignedIn }: { onSignedIn: (status: AuthStatus) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signUp = mode === 'sign-up';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('Use a password with at least 6 characters.');
    setBusy(true);
    try {
      onSignedIn(signUp ? await authApi.signUp(email, password, name) : await authApi.signIn(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const switchTo = (next: typeof mode) => {
    setMode(next);
    setError('');
  };

  return (
    <WelcomeLayout testId="auth-screen">
      <div className="welcome-card">
        <div className="welcome-head">
          <h1>{signUp ? 'Create your account' : 'Welcome back'}</h1>
          <p>{signUp ? 'It takes a minute. Your team is private to your account.' : 'Sign in to open your team.'}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {signUp && (
            <label className="field">
              <span>Your name</span>
              <input className="input" autoFocus autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} data-testid="auth-name" />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoFocus={!signUp} autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} data-testid="auth-email" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete={signUp ? 'new-password' : 'current-password'}
              placeholder={signUp ? 'At least 6 characters' : ''}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              data-testid="auth-password"
            />
          </label>
          {error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}
          <button className="btn primary auth-submit" disabled={busy || !email.trim() || !password || (signUp && !name.trim())} data-testid="auth-submit">
            {busy ? (signUp ? 'Creating your account…' : 'Signing in…') : signUp ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <div className="auth-switch">
          {signUp ? (
            <>Already have an account? <button type="button" onClick={() => switchTo('sign-in')}>Sign in</button></>
          ) : (
            <>New to Frog Bot? <button type="button" onClick={() => switchTo('sign-up')} data-testid="auth-to-sign-up">Create an account</button></>
          )}
        </div>
        {signUp && (
          <div className="auth-note">Your name and email are kept with your account so you can sign in. Your agents, chats, files and keys stay on this computer.</div>
        )}
      </div>
    </WelcomeLayout>
  );
}
