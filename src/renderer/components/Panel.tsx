import { useEffect, useMemo, useState } from 'react';
import type { Agent, Conversation, FileEntry } from '../../shared/types';
import { api } from '../api';
import { attempt, setState, toast, useStore } from '../store';
import { Avatar, ConfirmButton, GroupAvatar, Icon, Toggle, clock, plural, timeAgo } from './ui';
import { MODES } from './Live';
import { AvatarEditor } from './AvatarEditor';

type Tab = 'details' | 'library' | 'computer';

export function Panel() {
  const conversation = useStore((s) => s.conversations.find((c) => c.id === s.selectedId));
  const agents = useStore((s) => s.agents);
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  if (!conversation) return null;
  if (conversation.kind === 'group') return <GroupPanel conversation={conversation} agents={agents} agentById={agentById} />;
  const agent = agentById.get(conversation.memberIds[0]);
  return agent ? <AgentPanel agent={agent} /> : null;
}

function AgentPanel({ agent }: { agent: Agent }) {
  const [tab, setTab] = useState<Tab>('details');
  const runtime = useStore((s) => s.runtimes[agent.id]);
  const [label, setLabel] = useState(agent.label);
  useEffect(() => setLabel(agent.label), [agent.id, agent.label]);

  const saveLabel = () => {
    if (label !== agent.label) attempt(() => api.updateAgent(agent.id, { label }));
  };

  return (
    <aside className="panel" data-testid="panel">
      <div className="panel-head">
        <PanelClose />
        <Avatar agent={agent} size={64} status={runtime?.status ?? 'idle'} />
        <div className="panel-name">{agent.name}</div>
        <input className="label-input" value={label} placeholder="Add a label" onChange={(e) => setLabel(e.target.value)} onBlur={saveLabel} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </div>
      <div className="tabs">
        {(['details', 'library', 'computer'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} data-testid={`panel-tab-${t}`} onClick={() => setTab(t)}>
            {t === 'details' ? 'Settings' : t === 'library' ? 'Files' : 'Screen'}
          </button>
        ))}
      </div>
      {tab === 'details' && <DetailsTab key={agent.id} agent={agent} />}
      {tab === 'library' && <LibraryTab key={agent.id} agent={agent} />}
      {tab === 'computer' && <ComputerTab key={agent.id} agent={agent} />}
    </aside>
  );
}

function DetailsTab({ agent }: { agent: Agent }) {
  const settings = useStore((s) => s.settings);
  const integrations = useStore((s) => s.integrations);
  const allTasks = useStore((s) => s.tasks);
  const tasks = useMemo(() => allTasks.filter((t) => t.agentId === agent.id), [allTasks, agent.id]);
  const runtime = useStore((s) => s.runtimes[agent.id]);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [name, setName] = useState(agent.name);
  const dirty = instructions !== agent.instructions || name !== agent.name;

  const save = async () => {
    const updated = await attempt(() => api.updateAgent(agent.id, { instructions, name }), 'Could not save');
    if (updated) toast('Saved', `${updated.name} will use this from the next message.`, 'success');
  };

  const remove = async () => {
    await attempt(() => api.deleteAgent(agent.id));
    setState({ panelOpen: false });
  };

  return (
    <div className="panel-body" data-testid="panel-details">
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <AvatarEditor
        name={agent.name}
        allowLogo
        value={{ avatarStyle: agent.avatarStyle ?? 'initials', emoji: agent.emoji, color: agent.color, avatarImage: agent.avatarImage }}
        onChange={(v) => attempt(() => api.updateAgent(agent.id, v))}
      />
      <label className="field">
        <span>What should {agent.name} do?</span>
        <textarea className="textarea" rows={6} value={instructions} placeholder="Describe the job in plain words. For example: you are our researcher. Every morning, check the news on our industry and post a short summary…" onChange={(e) => setInstructions(e.target.value)} />
      </label>
      {dirty && <button className="btn primary" onClick={save}>Save changes</button>}

      <div className="field">
        <span>Mode in its own chat</span>
        <div className="mode-picker">
          {(['ask', 'auto', 'plan'] as const).map((m) => (
            <button key={m} className={`mode-option ${agent.autonomy === m ? 'on' : ''}`} onClick={() => attempt(() => api.updateAgent(agent.id, { autonomy: m }))}>
              <span>{MODES[m].icon}</span>
              <b>{MODES[m].label}</b>
              <small>{MODES[m].hint}</small>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Brain</span>
        <select className="select" value={agent.model} onChange={(e) => attempt(() => api.updateAgent(agent.id, { model: e.target.value }))}>
          {settings?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>

      <div className="field">
        <span>Apps {agent.name} can use</span>
        <div className="list">
          {integrations.filter((i) => i.enabled).map((i) => {
            const on = agent.integrations.includes(i.id);
            return (
              <div key={i.id} className="list-item">
                <span>{i.icon}</span><span className="grow">{i.name}</span>
                <Toggle on={on} onChange={(v) => attempt(() => api.updateAgent(agent.id, { integrations: v ? [...agent.integrations, i.id] : agent.integrations.filter((x) => x !== i.id) }))} />
              </div>
            );
          })}
        </div>
      </div>

      {agent.alwaysAllow.length > 0 && (
        <div className="field">
          <span>Always allowed</span>
          <div className="list">
            {agent.alwaysAllow.map((tool) => (
              <div key={tool} className="list-item">
                <span className="grow" title={tool}>{tool.replace(/^mcp__/, '').replace(/__/g, ' → ')}</span>
                <button className="icon-btn" title="Ask again next time" onClick={() => attempt(() => api.updateAgent(agent.id, { alwaysAllow: agent.alwaysAllow.filter((t) => t !== tool) }))}><Icon.Close size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="field">
          <span>Repeating jobs</span>
          <div className="list">
            {tasks.map((t) => (
              <div key={t.id} className="list-item">
                <span className="grow" title={t.prompt}>Every {t.everyMinutes} min · {t.prompt}</span>
                <button className="icon-btn" title="Cancel" onClick={() => attempt(() => api.deleteTask(t.id))}><Icon.Trash /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="muted">
        Used this session: {(runtime?.tokens ?? 0).toLocaleString()} tokens
        {runtime?.costUsd ? ` · $${runtime.costUsd.toFixed(2)}` : ''}
      </div>
      <ConfirmButton confirmText={`Tap again to remove ${agent.name} (files are kept)`} onConfirm={remove}>
        <Icon.Trash /> Remove {agent.name}
      </ConfirmButton>
    </div>
  );
}

function LibraryTab({ agent }: { agent: Agent }) {
  const [sub, setSub] = useState('');
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const runtime = useStore((s) => s.runtimes[agent.id]);
  const home = useStore((s) => s.settings?.homeDir);

  useEffect(() => {
    let alive = true;
    api.listFiles(agent.id, sub).then((f) => alive && setFiles(f)).catch(() => alive && setFiles([]));
    return () => {
      alive = false;
    };
  }, [agent.id, sub, runtime?.status]);

  return (
    <div className="panel-body" data-testid="panel-library">
      <div className="row between">
        <div className="muted">{sub ? `…/${sub}` : `${agent.name}'s folder`}</div>
        {sub && <button className="btn ghost" onClick={() => setSub(sub.split(/[\\/]/).slice(0, -1).join('/'))}><Icon.Back /> Back</button>}
      </div>
      <div className="list">
        {files === null && <div className="muted">Loading…</div>}
        {files?.length === 0 && <div className="muted">Nothing here yet. Files {agent.name} makes will show up here.</div>}
        {files?.map((f) => (
          <div key={f.path} className="list-item clickable" onClick={() => (f.isDir ? setSub(sub ? `${sub}/${f.name}` : f.name) : attempt(() => api.openPath(f.path)))}>
            {f.isDir ? <Icon.Folder /> : <Icon.File />}
            <span className="grow">{f.name}</span>
            <span className="muted">{f.isDir ? '' : formatSize(f.size)}</span>
          </div>
        ))}
      </div>
      {home && (
        <button className="btn" onClick={() => attempt(() => api.openPath(joinPath(home, 'agents', agent.folder, sub)))}>
          <Icon.Folder /> Open in file explorer
        </button>
      )}
    </div>
  );
}

function joinPath(...parts: string[]) {
  const sep = parts[0].includes('\\') ? '\\' : '/';
  return parts.filter(Boolean).map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '').replace(/[\\/]/g, sep))).join(sep);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_WORDS = { idle: 'resting', working: 'working', waiting: 'waiting for you', error: 'had a problem' } as const;

/** Sign in to a site in the agent's own browser once; it stays signed in for the agent. */
function SignInBox({ agent, busy }: { agent: Agent; busy: boolean }) {
  const [url, setUrl] = useState('');
  const open = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await attempt(() => api.openAgentBrowser(agent.id, url).then(() => true), 'Could not open the browser');
    if (ok) toast(`${agent.name}'s browser is open`, 'Sign in there, then close the window. It stays signed in for this agent.', 'success');
  };
  return (
    <form className="signin-box" onSubmit={open} data-testid="signin-box">
      <div className="subhead">Sign in for {agent.name}</div>
      <p className="muted">Open {agent.name}'s own browser and log in to a site once. {agent.name} stays signed in. You can also give it a username and password in chat.</p>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Website, e.g. mail.google.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={busy} title={busy ? `${agent.name} is using its browser right now` : undefined}>Open browser</button>
      </div>
    </form>
  );
}

function ComputerTab({ agent }: { agent: Agent }) {
  const runtime = useStore((s) => s.runtimes[agent.id]);
  const busy = runtime?.status === 'working' || runtime?.status === 'waiting';
  const activity = [...(runtime?.activity ?? [])].reverse().slice(0, 60);
  return (
    <div className="panel-body" data-testid="panel-computer">
      <div className="computer">
        {runtime?.lastScreenshot ? (
          <>
            <img src={runtime.lastScreenshot} alt={`${agent.name}'s browser`} />
            {busy && <span className="live">LIVE</span>}
          </>
        ) : busy ? (
          <div className="asleep"><Icon.Monitor /> {agent.name} is working…<span className="muted">{runtime?.currentTask}</span></div>
        ) : (
          <div className="asleep"><Icon.Moon /> Computer is asleep</div>
        )}
      </div>
      <SignInBox agent={agent} busy={busy} />
      <div className="row between">
        <span className="subhead">What {agent.name} is doing</span>
        <span className={`chip ${busy ? 'busy' : runtime?.status === 'error' ? 'err' : ''}`}>{STATUS_WORDS[runtime?.status ?? 'idle']}</span>
      </div>
      <div className="activity">
        {activity.length === 0 && <div className="muted">Nothing yet. Steps show up here live while {agent.name} works.</div>}
        {activity.map((item) => (
          <div key={item.id} className="activity-item">
            <span>{item.kind === 'tool' ? <Icon.Tool /> : item.kind === 'result' ? <Icon.Check size={13} /> : <Icon.Dot />}</span>
            <div>
              {item.detail ? (
                <details>
                  <summary className="t">{item.title}</summary>
                  <pre>{item.detail}</pre>
                </details>
              ) : (
                <div className="t">{item.title}</div>
              )}
              <time title={new Date(item.at).toLocaleString()}>{clock(item.at)} · {timeAgo(item.at)}</time>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupPanel({ conversation, agents, agentById }: { conversation: Conversation; agents: Agent[]; agentById: Map<string, Agent> }) {
  const runtimes = useStore((s) => s.runtimes);
  const members = conversation.memberIds.map((id) => agentById.get(id)).filter(Boolean) as Agent[];
  const others = agents.filter((a) => !conversation.memberIds.includes(a.id));
  const setMembers = (ids: string[]) => attempt(() => api.updateGroup(conversation.id, { memberIds: ids }));
  return (
    <aside className="panel" data-testid="panel">
      <div className="panel-head">
        <PanelClose />
        <GroupAvatar members={members} size={64} />
        <div className="panel-name">{conversation.title}</div>
        <div className="muted">{plural(members.length, "member")}</div>
      </div>
      <div className="tabs"><button className="tab active">Members</button></div>
      <div className="panel-body" data-testid="panel-members">
        <div className="list">
          {members.map((m) => (
            <div key={m.id} className="list-item">
              <Avatar agent={m} size={26} status={runtimes[m.id]?.status ?? 'idle'} />
              <span className="grow">{m.name}</span>
              <button className="btn ghost danger" style={{ padding: '3px 8px' }} onClick={() => setMembers(conversation.memberIds.filter((id) => id !== m.id))}>Remove</button>
            </div>
          ))}
        </div>
        {others.length > 0 && (
          <div className="field">
            <span>Add member</span>
            <div className="list">
              {others.map((a) => (
                <div key={a.id} className="list-item clickable" onClick={() => setMembers([...conversation.memberIds, a.id])}>
                  <Avatar agent={a} size={26} /><span className="grow">{a.name}</span><Icon.Plus size={15} />
                </div>
              ))}
            </div>
          </div>
        )}
        <ConfirmButton confirmText="Tap again to delete this group" onConfirm={() => attempt(() => api.deleteConversation(conversation.id)).then(() => setState({ panelOpen: false }))}>
          <Icon.Trash /> Delete group
        </ConfirmButton>
      </div>
    </aside>
  );
}

function PanelClose() {
  return (
    <button className="icon-btn panel-close" title="Close" data-testid="close-panel" onClick={() => setState({ panelOpen: false })}>
      <Icon.Close size={16} />
    </button>
  );
}
