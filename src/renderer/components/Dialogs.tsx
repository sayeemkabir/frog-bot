import { useState } from 'react';
import { api } from '../api';
import { attempt, selectConversation, setState, toast, useStore } from '../store';
import { Avatar, Sheet } from './ui';
import { AVATAR_COLORS, AVATAR_EMOJIS, AvatarEditor, type AvatarValue } from './AvatarEditor';

const ROLE_IDEAS = [
  { name: 'Researcher', label: 'Finds and checks information', instructions: 'Research topics thoroughly on the web and in our files. Cite sources. Save findings to the shared folder.' },
  { name: 'Writer', label: 'Drafts posts, emails and docs', instructions: 'Write clear drafts in the house voice. Save drafts to the shared folder and ask before anything is published or sent.' },
  { name: 'Transcriber', label: 'Turns videos and audio into text', instructions: 'Get transcripts fast: try the video page captions or a transcript site with web_search and fetch_url first, and only drive the browser if that fails. Save transcripts to the shared folder.' },
];

export function AgentDialog() {
  const agentCount = useStore((s) => s.agents.length);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [avatar, setAvatar] = useState<AvatarValue>({
    avatarStyle: 'initials',
    emoji: AVATAR_EMOJIS[(agentCount + 1) % AVATAR_EMOJIS.length],
    color: AVATAR_COLORS[(agentCount + 1) % AVATAR_COLORS.length],
  });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const result = await attempt(() => api.createAgent({ name, label, instructions, ...avatar }), 'Could not create the agent');
    setSaving(false);
    if (result) {
      setState({ sheet: null });
      toast(`${result.agent.name} joined the team`, 'Say hi to give them their first job.', 'success');
      await selectConversation(result.conversation.id);
    }
  };

  return (
    <Sheet testId="agent-dialog" title="New agent" subtitle="An agent is a teammate with its own job, memory and computer." onClose={() => setState({ sheet: null })} small>
      <form className="list" style={{ gap: 14 }} onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input className="input" data-testid="agent-name" autoFocus placeholder="e.g. Docs Guy" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <AvatarEditor name={name || 'New agent'} value={avatar} onChange={setAvatar} />
        <label className="field">
          <span>Role (one line)</span>
          <input className="input" data-testid="agent-label" placeholder="e.g. Writes and reviews drafts" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span>What should this agent do?</span>
          <textarea className="textarea" data-testid="agent-instructions" rows={5} placeholder="Explain the job like you would to a new teammate." value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        {!name && (
          <div className="field">
            <span>Or start from an idea</span>
            <div className="actions">
              {ROLE_IDEAS.map((r) => (
                <button type="button" key={r.name} className="choice" onClick={() => { setName(r.name); setLabel(r.label); setInstructions(r.instructions); }}>{r.name}</button>
              ))}
            </div>
          </div>
        )}
        <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={() => setState({ sheet: null })}>Cancel</button>
          <button className="btn primary" data-testid="agent-save" disabled={!name.trim() || saving}>{saving ? 'Creating…' : 'Create agent'}</button>
        </div>
      </form>
    </Sheet>
  );
}

export function GroupDialog() {
  const agents = useStore((s) => s.agents);
  const [title, setTitle] = useState('');
  // Nobody is in a new group until you pick them.
  const [members, setMembers] = useState<string[]>([]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const group = await attempt(() => api.createGroup(title, members), 'Could not create the group');
    if (group) {
      setState({ sheet: null });
      await selectConversation(group.id);
    }
  };

  return (
    <Sheet testId="group-dialog" title="New group" subtitle="A group chat where several agents work together. Use @Name to talk to one of them." onClose={() => setState({ sheet: null })} small>
      <form className="list" style={{ gap: 14 }} onSubmit={save}>
        <label className="field">
          <span>Group name</span>
          <input className="input" data-testid="group-title" autoFocus placeholder="e.g. Reddit team" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field">
          <span>Members</span>
          <div className="list">
            {agents.map((a) => (
              <label key={a.id} className="check-row">
                <input type="checkbox" checked={members.includes(a.id)} onChange={(e) => setMembers((m) => (e.target.checked ? [...m, a.id] : m.filter((x) => x !== a.id)))} />
                <Avatar agent={a} size={26} />
                <span>{a.name}</span>
                <span className="muted" style={{ marginLeft: 'auto' }}>{a.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={() => setState({ sheet: null })}>Cancel</button>
          <button className="btn primary" data-testid="group-save" disabled={!title.trim() || members.length === 0}>Create group</button>
        </div>
      </form>
    </Sheet>
  );
}
