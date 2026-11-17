import { toast as sonner } from 'sonner';
import { create } from 'zustand';
import { api } from './api';
import { navigate } from './router';
import type { Approval, Conversation, Message, Notification, Settings, ToolState } from './types';

export interface Streaming {
  messageId: string;
  agent: string;
  text: string;
  thinking: string;
}
export interface Toast {
  id: string;
  title: string;
  body?: string;
  link?: string;
  tone?: 'default' | 'error' | 'success';
}

interface State {
  auth: 'loading' | 'setup' | 'login' | 'ready';
  settings: Settings | null;
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  streaming: Record<string, Streaming | undefined>;
  tools: Record<string, ToolState>;
  /** conversationId → runId for runs in progress, with their status. */
  runs: Record<string, { runId: string; status: string }>;
  approvals: Approval[];
  unread: number;
  toasts: Toast[];
  connected: boolean;

  boot(): Promise<void>;
  loadConversations(): Promise<void>;
  loadConversation(id: string): Promise<void>;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;
  setSettings(s: Settings): void;
}

export const useStore = create<State>((set, get) => ({
  auth: 'loading',
  settings: null,
  conversations: [],
  messages: {},
  streaming: {},
  tools: {},
  runs: {},
  approvals: [],
  unread: 0,
  toasts: [],
  connected: false,

  async boot() {
    const status = await api.get<{ setup: boolean; authed: boolean }>('/auth/status');
    if (!status.setup) return set({ auth: 'setup' });
    if (!status.authed) return set({ auth: 'login' });
    const b = await api.get<{ settings: Settings; approvals: Approval[]; activeRuns: { runId: string; conversationId: string }[]; unread: number }>('/bootstrap');
    const runs: State['runs'] = {};
    for (const r of b.activeRuns) runs[r.conversationId] = { runId: r.runId, status: 'running' };
    set({ settings: b.settings, approvals: b.approvals, runs, unread: b.unread, auth: 'ready' });
    await get().loadConversations();
  },

  async loadConversations() {
    set({ conversations: await api.get<Conversation[]>('/conversations') });
  },

  async loadConversation(id) {
    const data = await api.get<{ messages: Message[]; activeRun: string | null; approvals: Approval[]; activity: { tool: string; status: string }[] }>(`/conversations/${id}`);
    set((s) => {
      const runs = { ...s.runs };
      if (data.activeRun) runs[id] = runs[id] ?? { runId: data.activeRun, status: 'running' };
      else delete runs[id];
      const approvals = [...s.approvals.filter((a) => a.conversation_id !== id), ...data.approvals];
      return { messages: { ...s.messages, [id]: data.messages }, runs, approvals };
    });
  },

  toast(t) {
    const fn = t.tone === 'error' ? sonner.error : t.tone === 'success' ? sonner.success : sonner;
    fn(t.title, { description: t.body, action: t.link ? { label: 'Open', onClick: () => navigate(t.link!) } : undefined });
  },
  dismissToast() {},
  setSettings(settings) {
    set({ settings });
  },
}));

// ───────────────────────── Live events ─────────────────────────

type Handler = (ev: any) => void;
const bus = new Set<Handler>();
/** Subscribe a view to raw server events (used to refetch lists). */
export function onServerEvent(h: Handler) {
  bus.add(h);
  return () => {
    bus.delete(h);
  };
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function refreshConversationsSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void useStore.getState().loadConversations(), 250);
}

// Streamed tokens arrive dozens of times a second. Applying each one re-renders the chat, so
// they're buffered and applied at most every ~60 ms (one render per frame batch).
const pending = new Map<string, { messageId: string; text: string; thinking: string }>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function flushStream() {
  flushTimer = undefined;
  if (!pending.size) return;
  const batch = [...pending];
  pending.clear();
  useStore.setState((st) => {
    const streaming = { ...st.streaming };
    for (const [cid, d] of batch) {
      const cur = streaming[cid];
      if (!cur || cur.messageId !== d.messageId) continue;
      streaming[cid] = { ...cur, text: cur.text + d.text, thinking: cur.thinking + d.thinking };
    }
    return { streaming };
  });
}

function handle(ev: any) {
  const set = useStore.setState;
  const s = useStore.getState();
  switch (ev.type) {
    case 'message': {
      if (pending.size) flushStream();
      const m: Message = ev.message;
      const list = s.messages[m.conversation_id];
      set((st) => ({
        messages: list ? { ...st.messages, [m.conversation_id]: [...list.filter((x) => x.id !== m.id), m] } : st.messages,
        streaming:
          st.streaming[m.conversation_id]?.messageId === m.id ? { ...st.streaming, [m.conversation_id]: undefined } : st.streaming,
      }));
      refreshConversationsSoon();
      break;
    }
    case 'stream.start':
      pending.delete(ev.conversationId);
      set((st) => ({ streaming: { ...st.streaming, [ev.conversationId]: { messageId: ev.messageId, agent: ev.agent, text: '', thinking: '' } } }));
      break;
    case 'stream.text':
    case 'stream.thinking': {
      const cur = s.streaming[ev.conversationId];
      if (!cur || cur.messageId !== ev.messageId) break;
      let p = pending.get(ev.conversationId);
      if (!p || p.messageId !== ev.messageId) pending.set(ev.conversationId, (p = { messageId: ev.messageId, text: '', thinking: '' }));
      if (ev.type === 'stream.text') p.text += ev.text;
      else p.thinking += ev.text;
      flushTimer ??= setTimeout(flushStream, 60);
      break;
    }
    case 'tool.start':
      set((st) => ({
        tools: {
          ...st.tools,
          [ev.callId]: {
            callId: ev.callId, parentCallId: ev.parentCallId, conversationId: ev.conversationId, name: ev.name, label: ev.label,
            summary: ev.summary, agent: ev.agent, args: ev.args, status: 'running', progress: '', started: Date.now(),
          },
        },
      }));
      break;
    case 'tool.waiting':
    case 'tool.progress':
    case 'tool.end': {
      const cur = s.tools[ev.callId];
      if (!cur) break;
      const next: ToolState =
        ev.type === 'tool.waiting'
          ? { ...cur, status: 'waiting' }
          : ev.type === 'tool.progress'
            ? { ...cur, status: cur.status === 'waiting' ? 'running' : cur.status, progress: (cur.progress + (ev.kind === 'tool' ? `\n› ${ev.text}\n` : ev.text)).slice(-4000) }
            : { ...cur, status: ev.status, preview: ev.preview, ended: Date.now() };
      set((st) => ({ tools: { ...st.tools, [ev.callId]: next } }));
      break;
    }
    case 'run.status': {
      set((st) => {
        const runs = { ...st.runs };
        if (ev.status === 'running' || ev.status === 'waiting') runs[ev.conversationId] = { runId: ev.runId, status: ev.status };
        else delete runs[ev.conversationId];
        const streaming = ev.status === 'running' || ev.status === 'waiting' ? st.streaming : { ...st.streaming, [ev.conversationId]: undefined };
        return { runs, streaming };
      });
      if (ev.status === 'error') s.toast({ title: 'Something went wrong', body: ev.error, tone: 'error' });
      refreshConversationsSoon();
      break;
    }
    case 'approval.requested':
      set((st) => ({ approvals: [...st.approvals.filter((a) => a.id !== ev.approval.id), ev.approval] }));
      break;
    case 'approval.resolved':
      set((st) => ({ approvals: st.approvals.filter((a) => a.id !== ev.id) }));
      break;
    case 'conversation.changed':
      refreshConversationsSoon();
      break;
    case 'notification':
      set((st) => ({ unread: st.unread + 1 }));
      if (ev.notification.kind !== 'approval' || document.hidden) {
        s.toast({ title: ev.notification.title, body: ev.notification.body, link: ev.notification.link });
      }
      break;
    case 'notifications.read':
      set({ unread: 0 });
      break;
    case 'settings.changed':
      void api.get<Settings>('/settings').then((settings) => set({ settings }));
      break;
  }
  for (const h of bus) h(ev);
}

let source: EventSource | null = null;
export function connectEvents() {
  if (source) return;
  source = new EventSource('/api/events');
  source.onopen = () => {
    useStore.setState({ connected: true });
    // Catch up on anything missed while disconnected.
    const st = useStore.getState();
    void st.loadConversations();
    void api.get<Approval[]>('/approvals').then((approvals) => useStore.setState({ approvals }));
    for (const cid of Object.keys(st.messages)) void st.loadConversation(cid);
  };
  source.onerror = () => useStore.setState({ connected: false });
  source.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      console.error('bad event', err);
    }
  };
}
export function disconnectEvents() {
  source?.close();
  source = null;
}
