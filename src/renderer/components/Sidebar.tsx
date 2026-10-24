import { useMemo, useState } from 'react';
import type { Agent, Conversation } from '../../shared/types';
import { selectConversation, setState, useStore } from '../store';
import { AppIcon, Avatar, GroupAvatar, Icon, Logo } from './ui';
import { stepText } from './Live';

export function Sidebar() {
  const conversations = useStore((s) => s.conversations);
  const agents = useStore((s) => s.agents);
  const runtimes = useStore((s) => s.runtimes);
  const selectedId = useStore((s) => s.selectedId);
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const integrations = useStore((s) => s.integrations);
  const integrationStatus = useStore((s) => s.integrationStatus);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: Conversation) => !q || c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q);
    const groups = conversations.filter((c) => c.kind === 'group' && match(c)).sort((a, b) => b.updatedAt - a.updatedAt);
    const bySection = new Map<string, Conversation[]>();
    for (const c of conversations.filter((c) => c.kind === 'direct' && match(c))) {
      const section = agentById.get(c.memberIds[0])?.section || 'Agents';
      bySection.set(section, [...(bySection.get(section) ?? []), c]);
    }
    const result: { label: string; items: Conversation[] }[] = [];
    if (groups.length) result.push({ label: 'Groups', items: groups });
    for (const [label, items] of bySection) result.push({ label, items: items.sort((a, b) => b.updatedAt - a.updatedAt) });
    return result;
  }, [conversations, agentById, query]);

  const enabled = integrations.filter((i) => i.enabled);
  const connected = enabled.filter((i) => integrationStatus[i.id]?.state === 'connected').length;
  const needsAuth = enabled.some((i) => integrationStatus[i.id]?.state === 'needs-auth' || integrationStatus[i.id]?.state === 'error');
  const workspace = settings?.workspaceName ?? 'Workspace';

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand"><Logo /> Frog Bot</div>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn accent" data-testid="new-menu" title="New" onClick={() => setMenu((m) => !m)}><Icon.Plus /></button>
          {menu && (
            <div className="card" style={{ position: 'absolute', right: 0, top: 38, zIndex: 20, minWidth: 190, padding: 6, gap: 2, animation: 'appear .15s var(--ease) both', boxShadow: 'var(--shadow)' }} onMouseLeave={() => setMenu(false)}>
              <button className="btn ghost" style={{ textAlign: 'left', border: 0 }} data-testid="new-agent" onClick={() => { setMenu(false); setState({ sheet: 'new-agent' }); }}><span className="row" style={{ gap: 8 }}><Icon.Plus size={15} /> New agent</span></button>
              <button className="btn ghost" style={{ textAlign: 'left', border: 0 }} data-testid="new-group" onClick={() => { setMenu(false); setState({ sheet: 'new-group' }); }}><span className="row" style={{ gap: 8 }}><Icon.Users size={15} /> New group</span></button>
            </div>
          )}
        </div>
      </div>

      <div className="segmented" role="tablist">
        <div className={`thumb ${view === 'logs' ? 'right' : ''}`} />
        <button className={view === 'chats' ? 'active' : ''} data-testid="nav-chats" onClick={() => setState({ view: 'chats' })}><Icon.Chat /> Chats</button>
        <button className={view === 'logs' ? 'active' : ''} data-testid="nav-logs" onClick={() => setState({ view: 'logs' })}><Icon.Terminal /> Logs</button>
      </div>

      <label className="search">
        <Icon.Search />
        <input placeholder="Search agents and chats" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div className="conv-list">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="section-label">{section.label}</div>
            {section.items.map((c, i) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                agents={c.memberIds.map((id) => agentById.get(id)).filter(Boolean) as Agent[]}
                status={c.kind === 'direct' ? runtimes[c.memberIds[0]]?.status : undefined}
                live={c.kind === 'direct' && runtimes[c.memberIds[0]]?.status === 'working' ? stepText(runtimes[c.memberIds[0]]!) : undefined}
                active={view === 'chats' && c.id === selectedId}
                delay={i * 25}
              />
            ))}
          </div>
        ))}
        {sections.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Nothing matches “{query}”.</div>}
      </div>

      <div className="sidebar-foot">
        <button className="integrations-bar" data-testid="open-integrations" onClick={() => setState({ sheet: 'integrations' })}>
          <Icon.Plug />
          <span className="label">
            Integrations
            <span className="sub">{connected} of {enabled.length} connected{needsAuth ? ' · needs you' : ''}</span>
          </span>
          <span className="stack-dots">
            {enabled.slice(0, 4).map((i) => {
              const state = integrationStatus[i.id]?.state;
              const color = state === 'connected' ? 'var(--accent)' : state === 'connecting' ? 'var(--info)' : state === 'needs-auth' ? 'var(--warn)' : state === 'error' ? 'var(--danger)' : '#3a4540';
              return <span key={i.id} title={`${i.name}: ${state}`}><AppIcon integration={i} size={18} /><i style={{ background: color }} /></span>;
            })}
          </span>
        </button>
        <div className="workspace-row">
          <div className="workspace-badge">{workspace.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
          <div className="workspace-name" title={workspace}>{workspace}</div>
          <button className="icon-btn" data-testid="open-settings" title="Settings" onClick={() => setState({ sheet: 'settings' })}><Icon.Gear /></button>
        </div>
      </div>
    </aside>
  );
}

function ConversationItem({ conversation, agents, status, live, active, delay }: {
  conversation: Conversation;
  live?: string;
  agents: Agent[];
  status?: 'idle' | 'working' | 'waiting' | 'error';
  active: boolean;
  delay: number;
}) {
  const agent = agents[0];
  return (
    <button
      className={`conv-item ${active ? 'active' : ''}`}
      data-testid="conversation-item"
      data-conversation-id={conversation.id}
      style={{ animationDelay: `${delay}ms` }}
      onClick={() => selectConversation(conversation.id)}
    >
      {conversation.kind === 'group' ? <GroupAvatar members={agents} size={34} /> : <Avatar agent={agent} size={34} status={status ?? 'idle'} />}
      <span className="conv-text">
        <span className="conv-title">{conversation.title}</span>
        <span className="conv-preview" style={{ display: 'block' }}>
          {status === 'working' ? live || 'Working…' : status === 'waiting' ? 'Waiting for you' : conversation.preview || (agent?.label ?? '')}
        </span>
      </span>
    </button>
  );
}
