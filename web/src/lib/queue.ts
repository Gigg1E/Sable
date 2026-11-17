import { create } from 'zustand';

/** Messages waiting to be sent when the current run in a chat finishes (kept per chat, in this tab). */
export interface Queued {
  id: string;
  text: string;
  attachments: string[];
}

interface QueueState {
  queues: Record<string, Queued[]>;
  add: (chat: string, item: Omit<Queued, 'id'>) => void;
  remove: (chat: string, id: string) => void;
  take: (chat: string) => Queued | undefined;
}

export const useQueue = create<QueueState>((set, get) => ({
  queues: {},
  add: (chat, item) => set((s) => ({ queues: { ...s.queues, [chat]: [...(s.queues[chat] ?? []), { ...item, id: Math.random().toString(36).slice(2) }] } })),
  remove: (chat, id) => set((s) => ({ queues: { ...s.queues, [chat]: (s.queues[chat] ?? []).filter((q) => q.id !== id) } })),
  take: (chat) => {
    const [first, ...rest] = get().queues[chat] ?? [];
    if (first) set((s) => ({ queues: { ...s.queues, [chat]: rest } }));
    return first;
  },
}));
