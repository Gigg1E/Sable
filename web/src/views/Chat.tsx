import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowDown, Brain, CalendarClock, ChevronRight, LayoutGrid, Plane, Search, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApprovalCard } from '../components/ApprovalCard';
import { Composer } from '../components/Composer';
import { Markdown } from '../components/Markdown';
import { Orb } from '../components/Orb';
import { ToolCallList } from '../components/ToolCall';
import { Spinner } from '../components/ui';
import { api } from '../lib/api';
import { cx, greeting } from '../lib/format';
import { navigate } from '../lib/router';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type Streaming } from '../lib/store';
import type { Message } from '../lib/types';

// ───────────────────────── Home (new chat) ─────────────────────────

const SUGGESTIONS = [
  { icon: Search, title: 'Research something', prompt: 'Research the best budget mechanical keyboards right now and give me a short list with prices and links.' },
  { icon: LayoutGrid, title: 'Build a tracker', prompt: 'Build me a habit tracker Space with daily check-offs and a streak counter.' },
  { icon: CalendarClock, title: 'Set up a routine', prompt: 'Every weekday at 8:00, check the weather for my city and notify me if I need an umbrella. Ask me which city first.' },
  { icon: Plane, title: 'Plan a trip', prompt: 'Help me plan a 3-day weekend trip. Ask me a few questions first, then make a goal with a plan.' },
];

export async function startChat(text: string) {
  const { id } = await api.post<{ id: string }>('/conversations');
  useStore.setState((s) => ({ messages: { ...s.messages, [id]: [] } }));
  navigate(`/chat/${id}`);
  try {
    await api.post(`/conversations/${id}/messages`, { text });
  } catch (err) {
    useStore.getState().toast({ title: 'Could not send', body: (err as Error).message, tone: 'error' });
  }
}

export function ChatHome() {
  const name = useStore((s) => s.settings?.persona.name ?? 'Sable');
  const approvals = useStore((s) => s.approvals);
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-10">
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }} className="mb-6 flex justify-center">
            <Orb size={72} />
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="text-center text-3xl font-semibold tracking-tight md:text-4xl">
            {greeting()}.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-2 text-center text-muted">
            What should {name} take care of?
          </motion.p>

          {approvals.length > 0 && (
            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => navigate('/inbox')} className="mx-auto mt-6 flex items-center gap-2 rounded-full bg-warn/10 px-4 py-2 text-sm text-warn">
              {approvals.length} action{approvals.length > 1 ? 's' : ''} waiting for your OK <ChevronRight className="size-4" />
            </motion.button>
          )}

          <div className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {SUGGESTIONS.map((s, i) => (
              <motion.button
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.05, type: 'spring', stiffness: 300, damping: 26 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => void startChat(s.prompt)}
                className="group flex items-start gap-3 rounded-2xl border border-line bg-surface/70 p-4 text-left backdrop-blur hover:border-line-strong hover:bg-surface transition-colors"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <s.icon className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{s.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{s.prompt}</span>
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-2xl px-3 pb-3 md:px-4 md:pb-5">
        <Composer onSend={startChat} autoFocus />
      </div>
    </div>
  );
}

// ───────────────────────── Conversation ─────────────────────────

type Turn = { kind: 'user'; message: Message } | { kind: 'agent'; messages: Message[]; key: string };

function groupTurns(messages: Message[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ kind: 'user', message: m });
    else {
      const last = out[out.length - 1];
      if (last?.kind === 'agent') last.messages.push(m);
      else out.push({ kind: 'agent', messages: [m], key: m.id });
    }
  }
  return out;
}

function Thinking({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="mb-1.5">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-xs text-subtle hover:text-muted">
        <Brain className="size-3.5" />
        <span className={live ? 'shimmer' : ''}>{live ? 'Thinking…' : 'Thought process'}</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }}>
          <ChevronRight className="size-3" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-1.5 border-l-2 border-line pl-3 text-[13px] text-muted whitespace-pre-wrap leading-relaxed">{text}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentTurn({ messages, streaming, working, waiting }: { messages: Message[]; streaming?: Streaming; working: boolean; waiting: boolean }) {
  const results = useMemo(() => {
    const r: Record<string, { content: string; isError: boolean }> = {};
    for (const m of messages) if (m.role === 'tool' && m.tool_call_id) r[m.tool_call_id] = { content: m.content, isError: m.is_error };
    return r;
  }, [messages]);
  const agentName = messages.find((m) => m.agent)?.agent ?? streaming?.agent;
  const visible = messages.filter((m) => m.role !== 'tool');
  const showWorking = working && !streaming?.text;

  return (
    <div className="flex gap-3">
      <div className="pt-0.5">
        <Orb size={26} state={waiting ? 'waiting' : working ? 'working' : 'idle'} />
      </div>
      <div className="min-w-0 flex-1">
        {agentName && <div className="mb-1 text-xs font-medium text-subtle">{agentName}</div>}
        {visible.map((m) =>
          m.role === 'error' ? (
            <motion.div key={m.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="my-2 flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{m.content}</span>
            </motion.div>
          ) : (
            <div key={m.id}>
              {m.thinking && <Thinking text={m.thinking} />}
              {m.content && <Markdown text={m.content} className="text-[15px]" />}
              {m.tool_calls && m.tool_calls.length > 0 && <ToolCallList calls={m.tool_calls} results={results} />}
            </div>
          ),
        )}
        {streaming && (
          <div>
            {streaming.thinking && <Thinking text={streaming.thinking} live={!streaming.text} />}
            {streaming.text && <Markdown text={streaming.text} className="text-[15px] caret" />}
          </div>
        )}
        <AnimatePresence>
          {showWorking && !waiting && !streaming?.thinking && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-1 text-sm shimmer">
              Working…
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function ChatView({ id }: { id: string }) {
  const messages = useStore((s) => s.messages[id]);
  const streaming = useStore((s) => s.streaming[id]);
  const runState = useStore((s) => s.runs[id]);
  const approvals = useStore(useShallow((s) => s.approvals.filter((a) => a.conversation_id === id)));
  const loadConversation = useStore((s) => s.loadConversation);
  const toast = useStore((s) => s.toast);
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setNotFound(false);
    loadConversation(id).catch(() => setNotFound(true));
  }, [id, loadConversation]);

  const turns = useMemo(() => groupTurns(messages ?? []), [messages]);
  const running = !!runState;
  const waiting = runState?.status === 'waiting' || approvals.length > 0;
  const lastIsAgent = turns[turns.length - 1]?.kind === 'agent';

  // Stick to the bottom while new content streams in, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text, streaming?.thinking, approvals.length, pinned, running]);

  async function send(text: string) {
    try {
      setPinned(true);
      await api.post(`/conversations/${id}/messages`, { text });
    } catch (err) {
      toast({ title: 'Could not send', body: (err as Error).message, tone: 'error' });
    }
  }
  async function stop() {
    if (runState) await api.post(`/runs/${runState.runId}/cancel`).catch(() => {});
  }

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <p>This chat doesn't exist anymore.</p>
        <button className="text-accent" onClick={() => navigate('/')}>
          Start a new one
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-7 px-4 pb-8 pt-6 md:px-6">
          {!messages && (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          )}
          {turns.map((t, i) =>
            t.kind === 'user' ? (
              <motion.div key={t.message.id} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="flex justify-end">
                <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-surface-2 border border-line px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                  {t.message.agent === 'Schedule' && (
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-accent">
                      <CalendarClock className="size-3" /> Scheduled run
                    </div>
                  )}
                  {t.message.content.replace(/^\[Scheduled task: [^\]]*\]\n/, '')}
                </div>
              </motion.div>
            ) : (
              <AgentTurn key={t.key} messages={t.messages} streaming={i === turns.length - 1 ? streaming : undefined} working={running && i === turns.length - 1} waiting={waiting && i === turns.length - 1} />
            ),
          )}
          {running && !lastIsAgent && <AgentTurn messages={[]} streaming={streaming} working waiting={waiting} />}

          <AnimatePresence>
            {approvals.map((a) => (
              <div key={a.id} className="pl-9">
                <ApprovalCard approval={a} />
              </div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {!pinned && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() => {
              setPinned(true);
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
            }}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 flex size-9 items-center justify-center rounded-full border border-line bg-surface shadow-soft text-muted"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>

      <div className={cx('mx-auto w-full max-w-3xl px-3 pb-3 md:px-6 md:pb-5')}>
        <Composer onSend={send} onStop={stop} running={running} autoFocus />
        {waiting && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-warn">
            <Sparkles className="size-3" /> Waiting for your OK above
          </p>
        )}
      </div>
    </div>
  );
}
