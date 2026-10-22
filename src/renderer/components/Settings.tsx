import { useState } from 'react';
import { api } from '../api';
import { attempt, setState, toast, useStore } from '../store';
import { Icon, Sheet, Toggle } from './ui';

export function SettingsSheet() {
  const settings = useStore((s) => s.settings);
  const [key, setKey] = useState('');
  const [workspace, setWorkspace] = useState(settings?.workspaceName ?? '');
  if (!settings) return null;

  const saveKey = async () => {
    const result = await attempt(() => api.setApiKey(key), 'Could not save the key');
    if (result) {
      setKey('');
      toast('API key saved', `Your agents use ${result.provider === 'openai' ? 'OpenAI' : 'Claude'} now.`, 'success');
    }
  };

  return (
    <Sheet testId="settings-sheet" title="Settings" subtitle="Everything stays on this computer." onClose={() => setState({ sheet: null })} small>
      <div className="field">
        <span>AI brain</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`chip ${settings.provider === 'anthropic' ? 'ok' : ''}`}>Claude {settings.hasClaudeKey ? '✓ key saved' : '· no key'}</span>
          <span className={`chip ${settings.provider === 'openai' ? 'ok' : ''}`}>OpenAI {settings.hasOpenAiKey ? '✓ key saved' : '· no key'}</span>
          <span className="muted">{settings.provider ? `Agents use ${settings.provider === 'anthropic' ? 'Claude' : 'OpenAI'} now.` : 'Add a key so agents can work.'}</span>
        </div>
      </div>

      <div className="field">
        <span>API key</span>
        <div className="row">
          <input
            className="input"
            type="password"
            placeholder="Paste a Claude (sk-ant-…) or OpenAI (sk-…) key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            data-testid="settings-api-key"
            autoComplete="off"
          />
          <button className="btn primary" disabled={!key.trim()} onClick={saveKey}>Save</button>
        </div>
        <small>Claude is used when it has a key; otherwise OpenAI. Keys are stored encrypted with your system keychain.</small>
      </div>

      <label className="field">
        <span>Team name</span>
        <input className="input" value={workspace} onChange={(e) => setWorkspace(e.target.value)} onBlur={() => workspace !== settings.workspaceName && attempt(() => api.updateSettings({ workspaceName: workspace }))} />
      </label>

      <label className="field">
        <span>Brain for new agents</span>
        <select className="select" value={settings.defaultModel} onChange={(e) => attempt(() => api.updateSettings({ defaultModel: e.target.value }))}>
          {settings.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>

      <div className="row between">
        <div>
          <div style={{ fontWeight: 600 }}>Start when my computer starts</div>
          <div className="muted">Agents keep working in the background while your computer is on.</div>
        </div>
        <Toggle on={settings.startAtLogin} onChange={(v) => attempt(() => api.updateSettings({ startAtLogin: v }))} />
      </div>

      <div className="row between">
        <div>
          <div style={{ fontWeight: 600 }}>Learn from my screen</div>
          <div className="muted">
            Saves a screenshot every {settings.watchMode.everyMinutes} min so agents can see how you work. Screenshots stay in FrogsWorld; an agent only sends one to Claude when it looks at it.
          </div>
        </div>
        <Toggle on={settings.watchMode.enabled} onChange={(v) => attempt(() => api.updateSettings({ watchMode: { ...settings.watchMode, enabled: v } }))} />
      </div>
      {settings.watchMode.enabled && (
        <label className="field">
          <span>Screenshot every (minutes)</span>
          <input
            className="input"
            type="number"
            min={1}
            max={120}
            defaultValue={settings.watchMode.everyMinutes}
            onBlur={(e) => attempt(() => api.updateSettings({ watchMode: { enabled: true, everyMinutes: Number(e.target.value) } }))}
          />
        </label>
      )}

      <div className="field">
        <span>Where your agents keep their files</span>
        <div className="row">
          <code className="input" style={{ fontFamily: 'var(--mono)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{settings.homeDir}</code>
          <button className="btn" onClick={() => attempt(() => api.openPath(settings.homeDir))}><Icon.Folder /></button>
        </div>
      </div>
      <div className="muted">Frog Bot 0.1.0 · Made by Sayeem Kabir</div>
    </Sheet>
  );
}
