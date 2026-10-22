import { useEffect } from 'react';
import { transport } from './api';
import { boot, selectConversation, setState, useStore } from './store';
import { Chat } from './components/Chat';
import { AgentDialog, GroupDialog } from './components/Dialogs';
import { IntegrationsSheet } from './components/Integrations';
import { LogsView } from './components/Logs';
import { Onboarding } from './components/Onboarding';
import { Panel } from './components/Panel';
import { SettingsSheet } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { Logo } from './components/ui';

export function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const sheet = useStore((s) => s.sheet);
  const settings = useStore((s) => s.settings);
  const onboardingDismissed = useStore((s) => s.onboardingDismissed);
  const panelOpen = useStore((s) => s.panelOpen);
  const hasSelection = useStore((s) => Boolean(s.selectedId));

  useEffect(() => {
    boot().catch((err) => setState({ ready: true, toasts: [{ id: 0, title: 'Could not start', body: String(err), tone: 'error' }] }));
  }, []);

  if (!ready) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <Logo className="big-logo" />
      </div>
    );
  }

  const showPanel = view === 'chats' && panelOpen && hasSelection;
  return (
    <>
      <div className="ambient" aria-hidden />
      <div className="titlebar" />
      <div className={`app ${transport.platform === 'darwin' ? 'mac' : ''} ${showPanel ? '' : 'panel-hidden'}`} data-testid="app-ready">
        <Sidebar />
        {view === 'logs' ? <LogsView /> : <Chat />}
        {showPanel && <Panel />}
      </div>
      {settings && !settings.hasApiKey && !onboardingDismissed && <Onboarding />}
      {sheet === 'integrations' && <IntegrationsSheet />}
      {sheet === 'settings' && <SettingsSheet />}
      {sheet === 'new-agent' && <AgentDialog />}
      {sheet === 'new-group' && <GroupDialog />}
      <Toasts />
    </>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.tone}`}
          style={{ cursor: t.conversationId ? 'pointer' : 'default' }}
          onClick={() => {
            if (t.conversationId) selectConversation(t.conversationId);
            setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
          }}
        >
          <b>{t.title}</b>
          {t.body && <span>{t.body}</span>}
        </div>
      ))}
    </div>
  );
}
