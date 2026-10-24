import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Conversation, Message } from '../../shared/types';
import { api } from '../api';
import { attempt, setState, useStore } from '../store';
import { Avatar, GroupAvatar, Icon, Logo, clock, plural, renderMarkdown } from './ui';
import { ModeBar, NeedsYouBar, WorkingBubbles, currentMode, nextMode } from './Live';

const NO_REPLY = /^\(?\s*no reply\s*\)?\.?$/i;

const SUGGESTIONS = [
  'What can you do for me?',
  'Find a YouTube video on making an omelette and give me the recipe from it',
  'Read the files in the shared folder and summarize them',
  'Make a plan for this week and split it across the team',
];

export function Chat() {
  const selectedId = useStore((s) => s.selectedId);
  const conversation = useStore((s) => s.conversations.find((c) => c.id === s.selectedId));
  const agents = useStore((s) => s.agents);
  const runtimes = useStore((s) => s.runtimes);
  const messages = useStore((s) => (s.selectedId ? s.messages[s.selectedId] : undefined));
  const panelOpen = useStore((s) => s.panelOpen);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const members = conversation ? (conversation.memberIds.map((id) => agentById.get(id)).filter(Boolean) as Agent[]) : [];

  if (!conversation || !selectedId) {
    return (
      <main className="chat">
        <div className="chat-head"><div className="grow" /></div>
        <div className="empty">
          <div>
            <Logo className="big-logo" />
            <h2>Pick a chat to start</h2>
            <p>Choose an agent on the left, or press + to add one.</p>
          </div>
        </div>
      </main>
    );
  }

  const working = members.filter((m) => runtimes[m.id]?.status === 'working' || runtimes[m.id]?.status === 'waiting');
  const direct = conversation.kind === 'direct' ? members[0] : undefined;
  // Say exactly who is doing what, and where, so nothing looks stuck.
  const describe = (m: Agent) => {
    const r = runtimes[m.id];
    const elsewhere = r?.conversationId && r.conversationId !== conversation.id;
    if (r?.status === 'waiting') return `${m.name} is waiting for you${elsewhere ? ' (see the bar above)' : ''}`;
    return `${m.name} is working${elsewhere ? ' in another chat' : ''}…`;
  };
  const statusText = direct
    ? working.length ? describe(direct) : direct.label || 'Ready'
    : working.length
      ? working.map(describe).join(' · ')
      : plural(members.length, 'member');

  return (
    <main className="chat">
      <div className="chat-head">
        {direct ? <Avatar agent={direct} size={34} status={runtimes[direct.id]?.status ?? 'idle'} /> : <GroupAvatar members={members} size={34} />}
        <div style={{ minWidth: 0 }}>
          <div className="title" data-testid="chat-title">{conversation.title}</div>
          <div className="status">{statusText}</div>
        </div>
        <div className="grow" />
        {working.length > 0 && (
          <button className="pill-btn danger" data-testid="stop" onClick={() => attempt(() => api.stopConversation(conversation.id))}>
            <Icon.Stop /> Stop
          </button>
        )}
        <button className={`pill-btn ${panelOpen ? 'on' : ''}`} data-testid="toggle-panel" onClick={() => setState((s) => ({ panelOpen: !s.panelOpen }))}>
          {direct ? <>Details</> : <><Icon.Users /> Members</>}
        </button>
      </div>
      <NeedsYouBar />
      <MessageList conversation={conversation} messages={messages ?? []} agentById={agentById} />
      <Composer conversation={conversation} members={members} />
    </main>
  );
}

function MessageList({ conversation, messages, agentById }: { conversation: Conversation; messages: Message[]; agentById: Map<string, Agent> }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const visible = messages.filter((m) => !(m.kind === 'text' && m.author.kind === 'agent' && (!m.text.trim() || NO_REPLY.test(m.text.trim()))));
  const last = visible[visible.length - 1];
  const agents = useStore((s) => s.agents);
  const runtimes = useStore((s) => s.runtimes);
  const mode = currentMode(conversation, agents);
  const busy = conversation.memberIds.some((id) => runtimes[id]?.status === 'working' || runtimes[id]?.status === 'waiting');
  const workingKey = Object.values(runtimes).map((r) => `${r.agentId}:${r.status}:${r.activity.length}`).join('|');

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible.length, last?.text, last?.id, workingKey]);

  useEffect(() => {
    stick.current = true;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.id]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (visible.length === 0) {
    const agent = conversation.kind === 'direct' ? agentById.get(conversation.memberIds[0]) : undefined;
    return (
      <div className="messages" ref={ref}>
        <div className="empty" style={{ height: '100%' }}>
          <div>
            {agent ? <div style={{ display: 'grid', placeItems: 'center' }}><Avatar agent={agent} size={72} /></div> : <Logo className="big-logo" />}
            <h2>{agent ? `Say hi to ${agent.name}` : `Welcome to ${conversation.title}`}</h2>
            <p>{agent?.label || 'Everyone in this group sees what you write. Use @Name to talk to one agent.'}</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="choice" onClick={() => attempt(() => api.sendMessage(conversation.id, s))}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  let lastDay = '';
  return (
    <div className="messages" ref={ref} onScroll={onScroll}>
      <div className="messages-inner">
        {visible.map((m) => {
          const day = new Date(m.createdAt).toDateString();
          const divider = day !== lastDay ? (lastDay = day) : null;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {divider && <div className="day-divider">{day === new Date().toDateString() ? 'Today' : new Date(m.createdAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>}
              <MessageView message={m} agent={m.author.kind === 'agent' ? agentById.get(m.author.agentId) : undefined} agentById={agentById} />
            </div>
          );
        })}
        {mode === 'plan' && !busy && last?.author.kind === 'agent' && last.kind === 'text' && (
          <div className="plan-actions">
            <button
              className="btn primary"
              data-testid="run-plan"
              onClick={async () => {
                await attempt(() => api.setMode(conversation.id, conversation.kind === 'group' ? 'each' : 'auto'));
                await attempt(() => api.sendMessage(conversation.id, 'Looks good. Go ahead with the plan.'));
              }}
            >
              <Icon.Bolt /> Run this plan
            </button>
            <span className="muted">Switches to {conversation.kind === 'group' ? "each agent's own mode" : 'Auto'} and starts.</span>
          </div>
        )}
        <WorkingBubbles conversation={conversation} />
      </div>
    </div>
  );
}

function MessageView({ message, agent, agentById }: { message: Message; agent?: Agent; agentById: Map<string, Agent> }) {
  if (message.kind === 'relay' && message.relay) {
    const from = agentById.get(message.relay.fromAgentId);
    const to = agentById.get(message.relay.toAgentId);
    return (
      <div className="msg" data-testid="message">
        <div className="relay" title={message.text} onClick={(e) => e.currentTarget.classList.toggle('open')}>
          <Avatar agent={from} size={18} /><b>{from?.name ?? 'Agent'}</b><span className="arrow"><Icon.ArrowRight /></span><Avatar agent={to} size={18} /><b>{to?.name ?? 'Agent'}</b>
          <span className="relay-text">{message.text}</span>
        </div>
      </div>
    );
  }

  if (message.kind === 'error') {
    return (
      <div className="msg" data-testid="message">
        <div className="card error"><div className="card-title"><Icon.Alert />{message.text}</div></div>
      </div>
    );
  }

  const isUser = message.author.kind === 'user';
  return (
    <div className={`msg ${isUser ? 'user' : 'agent'}`} data-testid="message">
      {!isUser && <Avatar agent={agent} size={32} />}
      <div className="msg-body">
        {!isUser && (
          <div className="msg-author">{agent?.name ?? 'Frog Bot'} <time>{clock(message.createdAt)}</time></div>
        )}
        {message.kind === 'text' && (
          <div className="bubble">
            <span dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }} />
            {message.streaming && <span className="cursor" />}
          </div>
        )}
        {message.kind === 'question' && message.question && <QuestionCard message={message} />}
        {message.kind === 'approval' && message.approval && <ApprovalCard message={message} agent={agent} />}
        {message.kind === 'agent-request' && message.agentRequest && <AgentRequestCard message={message} />}
        {isUser && <div className="msg-author"><time>{clock(message.createdAt)}</time></div>}
      </div>
    </div>
  );
}

function QuestionCard({ message }: { message: Message }) {
  const q = message.question!;
  const [other, setOther] = useState('');
  if (q.answer) {
    return (
      <div className="card">
        <div className="card-title">{q.question}</div>
        <div className="answered"><span className="key"><Icon.Check /></span>{q.answer}</div>
      </div>
    );
  }
  return (
    <div className="card" data-testid="question-card">
      <div className="card-title">{q.question}</div>
      <div className="list">
        {q.options.map((option, i) => (
          <button key={option} className="choice" onClick={() => attempt(() => api.answerQuestion(message.id, option))}>
            <span className="key">{String.fromCharCode(65 + i)}</span>{option}
          </button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (other.trim()) attempt(() => api.answerQuestion(message.id, other.trim())); }}>
        <input className="input" placeholder="Or type your own answer…" value={other} onChange={(e) => setOther(e.target.value)} />
        <button className="btn" disabled={!other.trim()}>Answer</button>
      </form>
    </div>
  );
}

function ApprovalCard({ message, agent }: { message: Message; agent?: Agent }) {
  const a = message.approval!;
  const [showDetails, setShowDetails] = useState(false);
  const decided = a.decision;
  const label = { allow: 'You allowed this', always: 'You allowed this (always)', deny: "You didn't allow this" };
  return (
    <div className="card approval" data-testid="approval-card">
      <div className="card-title"><Icon.Shield /> {agent?.name ?? 'An agent'} wants to:</div>
      <div style={{ fontWeight: 550 }}>{message.text}</div>
      {showDetails && (
        <>
          <div className="card-sub">{a.summary.split('\n\n')[1] ?? ''}</div>
          <pre>{JSON.stringify(a.input, null, 2)}</pre>
        </>
      )}
      {decided ? (
        <div className={`decision ${decided}`}>{label[decided]}</div>
      ) : (
        <div className="actions">
          <button className="btn primary" data-testid="approve" onClick={() => attempt(() => api.decideApproval(message.id, 'allow'))}>Allow</button>
          {a.canAlwaysAllow !== false && <button className="btn" onClick={() => attempt(() => api.decideApproval(message.id, 'always'))}>Always allow</button>}
          <button className="btn danger" data-testid="deny" onClick={() => attempt(() => api.decideApproval(message.id, 'deny'))}>Don't allow</button>
          <button className="btn ghost" onClick={() => setShowDetails((v) => !v)}>{showDetails ? 'Hide details' : 'Details'}</button>
        </div>
      )}
    </div>
  );
}

function AgentRequestCard({ message }: { message: Message }) {
  const r = message.agentRequest!;
  return (
    <div className="card" data-testid="agent-request-card">
      <div className="card-title"><Icon.Users /> Can we add a new teammate?</div>
      <div><b>{r.name}</b>{r.label ? `: ${r.label}` : ''}</div>
      <div className="card-sub">{r.reason}</div>
      {r.decision ? (
        <div className={`decision ${r.decision}`}>{r.decision === 'approved' ? `${r.name} joined the team` : 'You said no'}</div>
      ) : (
        <div className="actions">
          <button className="btn primary" onClick={() => attempt(() => api.decideAgentRequest(message.id, 'approved'))}>Add {r.name}</button>
          <button className="btn" onClick={() => attempt(() => api.decideAgentRequest(message.id, 'declined'))}>Not now</button>
        </div>
      )}
    </div>
  );
}

function Composer({ conversation, members }: { conversation: Conversation; members: Agent[] }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const hasKey = useStore((s) => s.settings?.hasApiKey);
  const agents = useStore((s) => s.agents);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    ref.current?.focus();
  }, [conversation.id]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    setMention(null);
    await attempt(() => api.sendMessage(conversation.id, body), 'Could not send');
  };

  // @mention autocomplete: who can be mentioned here, and what has been typed after "@".
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  const mentionable = conversation.kind === 'group' ? members : agents.filter((a) => a.id !== conversation.memberIds[0]);
  const suggestions = mention
    ? mentionable.filter((a) => a.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6)
    : [];
  const updateMention = (value: string, caret: number) => {
    const m = /(^|\s)@([^@\n]{0,30})$/.exec(value.slice(0, caret));
    if (!m) return setMention(null);
    const query = m[2];
    const start = caret - query.length - 1;
    const any = mentionable.some((a) => a.name.toLowerCase().startsWith(query.toLowerCase()));
    setMention(any ? { query, start, index: 0 } : null);
  };
  const pick = (agent: Agent) => {
    if (!mention) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${agent.name} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    const pos = mention.start + agent.name.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="composer-wrap">
      {conversation.kind === 'group' && members.length > 0 && (
        <div className="mention-bar">
          {members.map((m) => (
            <button key={m.id} className="mention-chip" onClick={() => { setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.name} `); ref.current?.focus(); }}>
              <Avatar agent={m} size={16} /> {m.name}
            </button>
          ))}
        </div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {suggestions.length > 0 && (
          <div className="mention-popup" role="listbox" data-testid="mention-popup">
            {suggestions.map((a, i) => (
              <button
                type="button"
                key={a.id}
                role="option"
                aria-selected={i === mention!.index}
                className={`mention-option ${i === mention!.index ? 'on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              >
                <Avatar agent={a} size={22} />
                <b>{a.name}</b>
                <span className="muted">{a.label}</span>
              </button>
            ))}
            <div className="mention-hint">Tab or Enter to insert · Esc to close</div>
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          data-testid="composer"
          placeholder={conversation.kind === 'group' ? `Message ${conversation.title}… (type @ to mention an agent)` : `Message ${conversation.title}…`}
          value={text}
          onChange={(e) => { setText(e.target.value); updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setMention((m) => m && { ...m, index: (m.index + step + suggestions.length) % suggestions.length });
                return;
              }
              if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                pick(suggestions[mention!.index] ?? suggestions[0]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
            if (e.key === 'Tab' && e.shiftKey) {
              // Same as Claude Code: Shift+Tab cycles the mode.
              e.preventDefault();
              attempt(() => api.setMode(conversation.id, nextMode(conversation, currentMode(conversation, agents))));
            }
          }}
        />
        <button className="send-btn" data-testid="send" disabled={!text.trim()} aria-label="Send"><Icon.Send /></button>
      </form>
      <ModeBar conversation={conversation} />
      {!hasKey && (
        <div className="hint">
          Add a Claude or OpenAI API key in <button className="btn ghost" style={{ padding: '0 4px', border: 0, color: 'var(--accent)' }} onClick={() => setState({ sheet: 'settings' })}>Settings</button> so agents can reply.
        </div>
      )}
    </div>
  );
}
