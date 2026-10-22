import { useMemo } from 'react';
import type { Agent, AgentRuntime, Conversation, GroupMode, Mode } from '../../shared/types';
import { api } from '../api';
import { attempt, selectConversation, useStore } from '../store';
import { Avatar } from './ui';

export const MODES: Record<GroupMode, { icon: string; label: string; hint: string }> = {
  ask: { icon: '✋', label: 'Ask first', hint: 'asks before changing things' },
  auto: { icon: '⚡', label: 'Auto', hint: 'works on its own, asks only before sending or deleting' },
  plan: { icon: '📝', label: 'Plan', hint: 'looks around and plans, changes nothing' },
  each: { icon: '👥', label: "Each agent's own mode", hint: 'every agent uses the mode set in its own chat' },
};

const DIRECT_ORDER: Mode[] = ['ask', 'auto', 'plan'];
const GROUP_ORDER: GroupMode[] = ['each', 'ask', 'auto', 'plan'];

export function currentMode(conversation: Conversation, agents: Agent[]): GroupMode {
  if (conversation.kind === 'group') return conversation.mode ?? 'each';
  return agents.find((a) => a.id === conversation.memberIds[0])?.autonomy ?? 'ask';
}

export function nextMode(conversation: Conversation, mode: GroupMode): GroupMode {
  const order: GroupMode[] = conversation.kind === 'group' ? GROUP_ORDER : DIRECT_ORDER;
  return order[(order.indexOf(mode) + 1) % order.length];
}

/** The small mode switch under the message box (click it, or Shift+Tab in the box). */
export function ModeBar({ conversation }: { conversation: Conversation }) {
  const agents = useStore((s) => s.agents);
  const mode = currentMode(conversation, agents);
  const info = MODES[mode];
  return (
    <div className="mode-bar">
      <button
        type="button"
        className={`mode-chip mode-${mode}`}
        data-testid="mode-chip"
        title="Click or press Shift+Tab to switch"
        onClick={() => attempt(() => api.setMode(conversation.id, nextMode(conversation, mode)))}
      >
        <span className="mode-icon">{info.icon}</span>
        <b>{info.label}</b>
        <span className="mode-hint">· {info.hint}</span>
      </button>
      <span className="mode-keys">shift+tab to switch</span>
    </div>
  );
}

function stepText(runtime: AgentRuntime) {
  const last = [...runtime.activity].reverse().find((a) => a.kind === 'tool');
  if (!last || Date.now() - last.at > 60_000) return 'Thinking…';
  return last.title.length > 90 ? `${last.title.slice(0, 90)}…` : last.title;
}

/** Live "who is working on what" at the bottom of a chat, with a hand-off beam for teamwork. */
export function WorkingBubbles({ conversation }: { conversation: Conversation }) {
  const runtimes = useStore((s) => s.runtimes);
  const agents = useStore((s) => s.agents);
  const active = useMemo(
    () =>
      agents
        .filter((a) => conversation.memberIds.includes(a.id) || runtimes[a.id]?.conversationId === conversation.id)
        .map((a) => ({ agent: a, runtime: runtimes[a.id] }))
        .filter(({ runtime }) => runtime && runtime.status === 'working' && runtime.conversationId === conversation.id),
    [agents, runtimes, conversation],
  );
  if (active.length === 0) return null;
  return (
    <div className="working-wrap" data-testid="working">
      {active.length >= 2 && (
        <div className="teamwork">
          <div className="teamwork-avatar"><Avatar agent={active[0].agent} size={34} /></div>
          <div className="beam">
            <i /><i /><i />
          </div>
          <div className="teamwork-avatar"><Avatar agent={active[1].agent} size={34} /></div>
          <span className="teamwork-label">{active[0].agent.name} and {active[1].agent.name} are working together</span>
        </div>
      )}
      {active.map(({ agent, runtime }) => (
        <div key={agent.id} className="working-bubble" style={{ ['--glow' as string]: agent.color }}>
          <div className="bloom"><Avatar agent={agent} size={30} /></div>
          <div className="working-text">
            <b>{agent.name}</b>
            <span>{stepText(runtime!)}</span>
          </div>
          <div className="dots"><i /><i /><i /></div>
        </div>
      ))}
    </div>
  );
}

/** Anything any agent needs from the user, shown on whatever chat is open. */
export function NeedsYouBar() {
  const runtimes = useStore((s) => s.runtimes);
  const agents = useStore((s) => s.agents);
  const conversations = useStore((s) => s.conversations);
  const selectedId = useStore((s) => s.selectedId);
  const waiting = Object.values(runtimes).filter((r) => r.waitingOn && r.waitingOn.conversationId !== selectedId);
  if (waiting.length === 0) return null;
  return (
    <div className="needs-you" data-testid="needs-you">
      {waiting.map((runtime) => {
        const agent = agents.find((a) => a.id === runtime.agentId);
        const w = runtime.waitingOn!;
        const where = conversations.find((c) => c.id === w.conversationId);
        return (
          <div key={runtime.agentId} className="needs-card">
            <div className="bloom amber"><Avatar agent={agent} size={30} /></div>
            <div className="needs-text">
              <b>{agent?.name ?? 'An agent'} needs you</b>
              <span>{w.kind === 'approval' ? `Wants to: ${w.text}` : w.kind === 'question' ? w.text : w.text}</span>
              {where && <small>in {where.kind === 'direct' ? `${where.title}'s chat` : `“${where.title}”`}</small>}
            </div>
            <div className="needs-actions">
              {w.kind === 'approval' && (
                <>
                  <button className="btn primary" onClick={() => attempt(() => api.decideApproval(w.messageId, 'allow'))}>Allow</button>
                  <button className="btn danger" onClick={() => attempt(() => api.decideApproval(w.messageId, 'deny'))}>Don't allow</button>
                </>
              )}
              {w.kind === 'question' && w.options?.slice(0, 3).map((o) => (
                <button key={o} className="btn" onClick={() => attempt(() => api.answerQuestion(w.messageId, o))}>{o}</button>
              ))}
              {w.kind === 'agent-request' && (
                <>
                  <button className="btn primary" onClick={() => attempt(() => api.decideAgentRequest(w.messageId, 'approved'))}>Add</button>
                  <button className="btn" onClick={() => attempt(() => api.decideAgentRequest(w.messageId, 'declined'))}>Not now</button>
                </>
              )}
              <button className="btn ghost" onClick={() => selectConversation(w.conversationId)}>Open</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
