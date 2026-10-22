import { useSyncExternalStore } from 'react';
import type {
  Agent,
  AgentRuntime,
  Conversation,
  EngineEvent,
  ID,
  Integration,
  IntegrationStatus,
  IntegrationTemplate,
  LogEntry,
  Message,
  ScheduledTask,
  Settings,
} from '../shared/types';
import { api, transport } from './api';

export type View = 'chats' | 'logs';
export type Sheet = null | 'integrations' | 'settings' | 'new-agent' | 'new-group';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: 'info' | 'error' | 'success';
  conversationId?: ID;
}

export interface State {
  ready: boolean;
  settings: Settings | null;
  agents: Agent[];
  conversations: Conversation[];
  runtimes: Record<ID, AgentRuntime>;
  integrations: Integration[];
  integrationStatus: Record<ID, IntegrationStatus>;
  templates: IntegrationTemplate[];
  tasks: ScheduledTask[];
  messages: Record<ID, Message[]>;
  logs: LogEntry[];
  selectedId: ID | null;
  view: View;
  sheet: Sheet;
  toasts: Toast[];
  onboardingDismissed: boolean;
  panelOpen: boolean;
}

let state: State = {
  ready: false,
  settings: null,
  agents: [],
  conversations: [],
  runtimes: {},
  integrations: [],
  integrationStatus: {},
  templates: [],
  tasks: [],
  messages: {},
  logs: [],
  selectedId: null,
  view: 'chats',
  sheet: null,
  toasts: [],
  onboardingDismissed: false,
  panelOpen: false,
};

const listeners = new Set<() => void>();
const LOG_LIMIT = 4000;

export function getState() {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

let toastId = 0;
export function toast(title: string, body?: string, tone: Toast['tone'] = 'info', conversationId?: ID) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, title, body, tone, conversationId }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 4500);
}

/** Run an API call and show any failure as a toast. */
export async function attempt<T>(fn: () => Promise<T>, failTitle = 'Something went wrong'): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    toast(failTitle, err instanceof Error ? err.message : String(err), 'error');
    return undefined;
  }
}

function upsert<T>(list: T[], item: T, key: (t: T) => string) {
  const index = list.findIndex((x) => key(x) === key(item));
  if (index === -1) return [...list, item];
  const copy = list.slice();
  copy[index] = item;
  return copy;
}

function onEvent(event: EngineEvent) {
  switch (event.type) {
    case 'agent:upsert':
      setState((s) => ({ agents: upsert(s.agents, event.agent, (a) => a.id) }));
      break;
    case 'agent:remove':
      setState((s) => ({ agents: s.agents.filter((a) => a.id !== event.agentId) }));
      break;
    case 'conversation:upsert':
      setState((s) => ({ conversations: upsert(s.conversations, { ...event.conversation }, (c) => c.id) }));
      break;
    case 'conversation:remove':
      setState((s) => ({
        conversations: s.conversations.filter((c) => c.id !== event.conversationId),
        selectedId: s.selectedId === event.conversationId ? null : s.selectedId,
      }));
      break;
    case 'message:upsert': {
      const m = event.message;
      setState((s) => {
        const existing = s.messages[m.conversationId];
        if (!existing) return {};
        return { messages: { ...s.messages, [m.conversationId]: upsert(existing, { ...m }, (x) => x.id) } };
      });
      break;
    }
    case 'message:remove':
      setState((s) => {
        const existing = s.messages[event.conversationId];
        if (!existing) return {};
        return { messages: { ...s.messages, [event.conversationId]: existing.filter((m) => m.id !== event.messageId) } };
      });
      break;
    case 'runtime':
      setState((s) => ({ runtimes: { ...s.runtimes, [event.runtime.agentId]: { ...event.runtime, activity: [...event.runtime.activity] } } }));
      break;
    case 'integrations':
      setState({ integrations: event.integrations, integrationStatus: event.status });
      break;
    case 'tasks':
      setState({ tasks: event.tasks });
      break;
    case 'settings':
      setState({ settings: event.settings });
      break;
    case 'log':
      setState((s) => {
        const logs = s.logs.length >= LOG_LIMIT ? s.logs.slice(-LOG_LIMIT + 1) : s.logs.slice();
        logs.push(event.entry);
        return { logs };
      });
      break;
    case 'notify':
      if (event.conversationId !== state.selectedId || document.hidden) toast(event.title, event.body, 'info', event.conversationId);
      break;
  }
}

export async function boot() {
  transport.onEvent(onEvent);
  transport.onFocusConversation((id) => selectConversation(id));
  const [snapshot, logs] = await Promise.all([api.snapshot(), api.logs(2000)]);
  const sorted = [...snapshot.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  setState({
    ready: true,
    settings: snapshot.settings,
    agents: snapshot.agents,
    conversations: snapshot.conversations,
    runtimes: snapshot.runtimes,
    integrations: snapshot.integrations,
    integrationStatus: snapshot.integrationStatus,
    templates: snapshot.templates,
    tasks: snapshot.tasks,
    logs,
  });
  if (sorted[0]) await selectConversation(sorted[0].id);
}

export async function selectConversation(id: ID) {
  setState({ selectedId: id, view: 'chats' });
  if (!state.messages[id]) {
    const list = await api.messages(id);
    setState((s) => ({ messages: { ...s.messages, [id]: list } }));
  }
}
