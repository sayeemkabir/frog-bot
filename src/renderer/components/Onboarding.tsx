import { useState } from 'react';
import { api } from '../api';
import { attempt, setState, toast } from '../store';
import { Logo } from './ui';

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
    <div className="onboarding" data-testid="onboarding">
      <form className="onboarding-card" onSubmit={save}>
        <Logo className="big-logo" />
        <h1>Welcome to Frog Bot</h1>
        <p>Your local AI team: agents that live on this computer, work together, and ask you before they act for you.</p>
        <div className="steps">
          <div className="step"><span className="n">1</span><div><b>Paste your API key</b><span className="muted">A Claude key (console.anthropic.com) works best; an OpenAI key (platform.openai.com) works too. It stays encrypted on this computer.</span></div></div>
          <div className="step"><span className="n">2</span><div><b>Chat with Frog</b><span className="muted">Tell it what you need. Add more agents with the + button.</span></div></div>
        </div>
        <input className="input" type="password" autoFocus placeholder="sk-ant-… (Claude) or sk-… (OpenAI)" value={key} onChange={(e) => setKey(e.target.value)} data-testid="onboarding-key" style={{ padding: '12px 14px', fontSize: 15 }} />
        <button className="btn primary" style={{ padding: '12px', fontSize: 15 }} disabled={!key.trim() || saving}>{saving ? 'Saving…' : 'Start'}</button>
        <button type="button" className="btn ghost" data-testid="onboarding-skip" onClick={() => setState({ onboardingDismissed: true })}>I'll do this later</button>
      </form>
    </div>
  );
}
