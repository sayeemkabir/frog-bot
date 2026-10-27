import { useState } from 'react';
import type { Integration, IntegrationStatus, IntegrationTemplate } from '../../shared/types';
import { api } from '../api';
import { attempt, setState, toast, useStore } from '../store';
import { ConfirmButton, Icon, Sheet, Toggle, AppIcon } from './ui';

const STATE_LABEL: Record<IntegrationStatus['state'], { text: string; cls: string }> = {
  connected: { text: 'Connected', cls: 'ok' },
  connecting: { text: 'Connecting…', cls: 'busy' },
  'needs-auth': { text: 'Sign in needed', cls: 'warn' },
  error: { text: 'Problem', cls: 'err' },
  disabled: { text: 'Off', cls: '' },
};

export function IntegrationsSheet() {
  const integrations = useStore((s) => s.integrations);
  const status = useStore((s) => s.integrationStatus);
  const templates = useStore((s) => s.templates);
  const [adding, setAdding] = useState<IntegrationTemplate | null>(null);
  const close = () => setState({ sheet: null });

  return (
    <Sheet
      testId="integrations-sheet"
      title={adding ? <span className="row"><button className="icon-btn" onClick={() => setAdding(null)}><Icon.Back /></button><AppIcon integration={adding} size={24} /> Add {adding.name}</span> : 'Integrations'}
      subtitle={adding ? adding.description : 'The apps your agents can use. In Ask first mode, agents check with you before they post or send anything.'}
      onClose={close}
    >
      {adding ? (
        <AddForm template={adding} onDone={() => setAdding(null)} />
      ) : (
        <>
          <div className="grid-cards">
            {integrations.map((integration, i) => (
              <IntegrationCard key={integration.id} integration={integration} status={status[integration.id]} delay={i * 50} />
            ))}
          </div>
          <div className="subhead">Add another app</div>
          <div className="grid-cards">
            {templates.map((t) => (
              <button key={t.id} className="template-btn" data-testid={`template-${t.id}`} onClick={() => setAdding(t)}>
                <AppIcon integration={{ id: t.id, name: t.name, transport: t.transport }} />
                <span>
                  <b style={{ display: 'block' }}>{t.name}</b>
                  <span className="muted">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function IntegrationCard({ integration, status, delay }: { integration: Integration; status?: IntegrationStatus; delay: number }) {
  const state = integration.enabled ? status?.state ?? 'disabled' : 'disabled';
  const label = STATE_LABEL[state];
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    if (integration.auth === 'oauth') toast(`Opening ${integration.name} sign-in`, 'Finish signing in in your browser, then come back here.');
    const result = await attempt(() => api.connectIntegration(integration.id), `Could not connect ${integration.name}`);
    setBusy(false);
    if (result?.state === 'connected') toast(`${integration.name} connected`, result.detail, 'success');
  };

  return (
    <div className="int-card" data-integration-id={integration.id} style={{ animationDelay: `${delay}ms` }}>
      <div className="head">
        <AppIcon integration={integration} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">{integration.name}</div>
          <span className={`chip ${label.cls}`}>{label.text}{status?.toolCount ? ` · ${status.toolCount} tools` : ''}</span>
        </div>
        <Toggle on={integration.enabled} onChange={(v) => attempt(() => api.setIntegrationEnabled(integration.id, v))} />
      </div>
      <div className="desc">{integration.description}</div>
      {state === 'error' && status?.detail && <div className="muted" style={{ color: '#ff8a8d' }}>{status.detail}</div>}
      {integration.enabled && (
        <div className="actions">
          {integration.transport !== 'builtin-browser' && integration.transport !== 'stdio' && (
            state === 'connected' ? (
              <>
                <button className="btn" onClick={connect} disabled={busy}>Test</button>
                {integration.auth !== 'none' && <button className="btn ghost" onClick={() => attempt(() => api.disconnectIntegration(integration.id))}>Sign out</button>}
              </>
            ) : (
              <button className="btn primary" data-testid={`connect-${integration.id}`} onClick={connect} disabled={busy || state === 'connecting'}>
                {busy || state === 'connecting' ? 'Connecting…' : integration.auth === 'oauth' ? 'Connect' : 'Test connection'}
              </button>
            )
          )}
          {!integration.builtin && (
            <ConfirmButton confirmText="Tap again to remove" onConfirm={() => attempt(() => api.removeIntegration(integration.id))}>Remove</ConfirmButton>
          )}
        </div>
      )}
    </div>
  );
}

function AddForm({ template, onDone }: { template: IntegrationTemplate; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (template.url) initial.url = template.url;
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const added = await attempt(() => api.addIntegration({ templateId: template.id, values }), 'Could not add');
    setSaving(false);
    if (added) {
      toast(`${added.name} added`, added.auth === 'oauth' ? 'Finish signing in in your browser.' : 'Your agents can use it now.', 'success');
      onDone();
    }
  };
  return (
    <form className="list" style={{ gap: 14 }} onSubmit={submit} data-testid="integration-form">
      {template.help && (
        <div className="setup-help" data-testid="integration-help">
          <p>{template.help}</p>
          {template.manifest !== undefined && (
            <ol className="setup-steps">
              <li>
                <a
                  className="btn primary"
                  data-testid="create-app"
                  href={`https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(template.manifest))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Create my {template.name} app
                </a>
                <span className="muted">{template.name} opens with everything filled in. Pick your workspace, click Next, then Create.</span>
              </li>
              <li>
                <span>Then open Basic Information in {template.name}, copy the Client ID and Client Secret, and paste them below.</span>
              </li>
              <li>
                <span>Press Connect. Your browser opens {template.name}: click Allow.</span>
              </li>
            </ol>
          )}
          {template.manifest !== undefined && (
            <button
              type="button"
              className="link-btn"
              data-testid="copy-manifest"
              onClick={() =>
                navigator.clipboard
                  .writeText(JSON.stringify(template.manifest, null, 2))
                  .then(() => toast('Manifest copied', 'Paste it in Slack: Create New App → From a manifest.', 'success'))
              }
            >
              Copy manifest instead
            </button>
          )}
        </div>
      )}
      {(template.fields ?? []).map((field) => (
        <label key={field.key} className="field">
          <span>{field.label}</span>
          <input
            className="input"
            type={field.secret ? 'password' : 'text'}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            autoComplete="off"
          />
        </label>
      ))}
      <div className="muted">
        {template.auth === 'oauth'
          ? 'After you add it, your browser opens so you can sign in and click Allow. Frog Bot keeps you signed in after that.'
          : 'Tokens are stored encrypted on this computer and never leave it except to talk to that app.'}
      </div>
      <div className="actions">
        <button className="btn primary" disabled={saving}>{saving ? 'Connecting…' : template.manifest !== undefined ? 'Connect' : `Add ${template.name}`}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
