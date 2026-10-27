import { useState } from 'react';
import { api } from '../api';
import { attempt, setState, toast } from '../store';
import { WelcomeLayout } from './ui';

/** First launch: the only thing anyone has to do is paste an API key (Claude or OpenAI). */
export function Onboarding() {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const result = await attempt(() => api.setApiKey(key), 'That key did not work');
    setSaving(false);
    if (result?.hasApiKey) {
      toast('You are all set', 'Say hi to Frog to give your team its first job.', 'success');
      setState({ onboardingDismissed: true });
    }
  };

  return (
    <WelcomeLayout testId="onboarding">
      <form className="welcome-card" onSubmit={save}>
        <div className="welcome-head">
          <span className="welcome-step">Last step</span>
          <h1>Connect an AI model</h1>
          <p>Paste an API key so your agents can think. A Claude key (console.anthropic.com) works best; an OpenAI key (platform.openai.com) works too.</p>
        </div>
        <label className="field">
          <span>API key</span>
          <input className="input" type="password" autoFocus placeholder="sk-ant-… or sk-…" value={key} onChange={(e) => setKey(e.target.value)} data-testid="onboarding-key" />
          <small>Stored encrypted on this computer. You can change it later in Settings.</small>
        </label>
        <button className="btn primary auth-submit" disabled={!key.trim() || saving}>{saving ? 'Saving…' : 'Start'}</button>
        <button type="button" className="btn ghost" data-testid="onboarding-skip" onClick={() => setState({ onboardingDismissed: true })}>I'll do this later</button>
      </form>
    </WelcomeLayout>
  );
}
