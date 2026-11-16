import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowDown, ArrowRight, CalendarClock, ChevronRight, LayoutGrid, ListChecks, Plane, Search, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ApprovalCard } from '../components/ApprovalCard';
import { Composer, type ComposerHandle } from '../components/Composer';
import { Logo } from '../components/Logo';
import { Markdown } from '../components/Markdown';
import { ToolTrace } from '../components/ToolCall';
import { Button, Card, Page, Progress, SectionLabel, Spinner, StatusDot, Ticker, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { clockTime, cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore, type Streaming } from '../lib/store';
import type { Goal, Message, Schedule, Watcher } from '../lib/types';
import { Sparkline } from '../components/Sparkline';

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

// ───────────────────────── Home ─────────────────────────

const STARTERS = [
  { icon: Search, label: 'Research', text: 'Research ' },
  { icon: LayoutGrid, label: 'Build a space', text: 'Build me a space that ' },
  { icon: CalendarClock, label: 'Schedule a routine', text: 'Every weekday at 8:00, ' },
  { icon: Plane, label: 'Plan something', text: 'Help me plan ' },
];

export function ChatHome() {
  const name = useStore((s) => s.settings?.persona.name ?? 'Sable');
  const approvals = useStore((s) => s.approvals);
  const conversations = useStore((s) => s.conversations);
  const runs = useStore((s) => s.runs);
  const composer = useRef<ComposerHandle>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);

  useEffect(() => {
    const load = () => {
      void api.get<Goal[]>('/goals').then(setGoals);
      void api.get<Schedule[]>('/schedules').then(setSchedules);
      void api.get<Watcher[]>('/watchers').then(setWatchers);
    };
    load();
    return onServerEvent((ev) => (ev.type === 'goal.changed' || ev.type === 'schedule.changed' || ev.type === 'watcher.changed') && load());
  }, []);

  const active = goals.filter((g) => g.status === 'active' || g.status === 'blocked').slice(0, 4);
  const upcoming = schedules.filter((s) => s.enabled && s.next_run).sort((a, b) => a.next_run! - b.next_run!).slice(0, 4);
  const running = conversations.filter((c) => runs[c.id]);
  const recent = conversations.filter((c) => !runs[c.id]).slice(0, 6);

  return (
    <>
      <TopBar title="Home" />
      <Page width="md">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">What should {name} take on?</h1>
          <p className="mt-1 text-[13.5px] text-fg-2">Describe an outcome. It plans the steps, asks before anything sensitive, and keeps working in the background.</p>
          <div className="mt-5">
            <Composer ref={composer} onSend={startChat} autoFocus minRows={2} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button key={s.label} onClick={() => composer.current?.setText(s.text)} className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[12.5px] text-fg-2 shadow-1 transition-colors hover:border-line-strong hover:text-fg">
                <s.icon className="size-3.5 text-fg-3" /> {s.label}
              </button>
            ))}
          </div>
        </motion.div>

        <AnimatePresence>
          {approvals.length > 0 && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-10">
              <SectionLabel>
                <span className="text-accent">Needs your approval · {approvals.length}</span>
              </SectionLabel>
              <div className="space-y-2.5">
                <AnimatePresence>
                  {approvals.slice(0, 3).map((a) => (
                    <ApprovalCard key={a.id} approval={a} compact context={conversations.find((c) => c.id === a.conversation_id)?.title} />
                  ))}
                </AnimatePresence>
              </div>
              {approvals.length > 3 && (
                <button onClick={() => navigate('/inbox')} className="mt-2 text-[12.5px] text-fg-2 hover:text-fg">
                  View all in Inbox →
                </button>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {(running.length > 0 || active.length > 0) && (
          <section className="mt-10">
            <SectionLabel right={<button onClick={() => navigate('/goals')} className="text-xs text-fg-3 hover:text-fg">All goals</button>}>In progress</SectionLabel>
            <Card className="divide-y divide-line">
              {running.map((c) => (
                <button key={c.id} onClick={() => navigate(`/chat/${c.id}`)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-panel-2/60">
                  <StatusDot state={runs[c.id]?.status === 'waiting' ? 'waiting' : 'running'} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.title}</span>
                  <span className="font-mono text-[11px] text-fg-3">{runs[c.id]?.status === 'waiting' ? 'awaiting approval' : 'running'}</span>
                </button>
              ))}
              {active.map((g) => {
                const done = g.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
                return (
                  <button key={g.id} onClick={() => (g.conversation_id ? navigate(`/chat/${g.conversation_id}`) : navigate('/goals'))} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-panel-2/60">
                    <ListChecks className="size-3.5 shrink-0 text-fg-3" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{g.title}</span>
                    <span className="w-24">
                      <Progress value={g.steps.length ? (done / g.steps.length) * 100 : 0} />
                    </span>
                    <span className="w-9 text-right font-mono text-[11px] text-fg-3 tabular">
                      {done}/{g.steps.length}
                    </span>
                  </button>
                );
              })}
            </Card>
          </section>
        )}

        {watchers.filter((w) => w.enabled).length > 0 && (
          <section className="mt-10">
            <SectionLabel right={<button onClick={() => navigate('/watchers')} className="text-xs text-fg-3 hover:text-fg">All watchers</button>}>Watching</SectionLabel>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {watchers
                .filter((w) => w.enabled)
                .slice(0, 4)
                .map((w) => (
                  <button key={w.id} onClick={() => navigate('/watchers')} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-3 text-left shadow-1 transition-colors hover:border-line-strong">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{w.title}</div>
                      <div className={cx('truncate font-mono text-[13px] tabular', w.last_error ? 'text-danger' : 'text-fg')}>{w.last_error ? 'error' : w.extract.kind === 'text' ? 'tracking changes' : (w.last_value ?? '—')}</div>
                      <div className="truncate text-[11px] text-fg-3">{w.conditionLabel}</div>
                    </div>
                    <Sparkline points={w.spark} width={84} height={30} />
                  </button>
                ))}
            </div>
          </section>
        )}

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
          <section className="min-w-0">
            <SectionLabel>Recent</SectionLabel>
            {recent.length ? (
              <Card className="divide-y divide-line">
                {recent.map((c) => (
                  <button key={c.id} onClick={() => navigate(`/chat/${c.id}`)} className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-panel-2/60">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px]">{c.title}</div>
                      {c.preview && <div className="mt-0.5 truncate text-[12.5px] text-fg-3">{c.preview.replace(/[#*_`>]/g, '')}</div>}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-fg-3">{timeAgo(c.updated_at)}</span>
                    <ChevronRight className="size-3.5 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </Card>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-3">Your conversations will appear here.</p>
            )}
          </section>
          <section>
            <SectionLabel right={<button onClick={() => navigate('/routines')} className="text-xs text-fg-3 hover:text-fg">Manage</button>}>Upcoming routines</SectionLabel>
            {upcoming.length ? (
              <div className="space-y-px">
                {upcoming.map((s) => (
                  <div key={s.id} className="flex items-baseline gap-2 py-1.5">
                    <span className="w-[86px] shrink-0 font-mono text-[11px] text-fg-3">{clockTime(s.next_run!).replace(/^\w+, /, '')}</span>
                    <span className="truncate text-[13px] text-fg-2">{s.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-fg-3">
                Nothing scheduled. Try “Every morning at 7, brief me on the weather and my open goals.”
              </p>
            )}
          </section>
        </div>
      </Page>
    </>
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

function Reasoning({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="mb-2">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg-2">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight className="size-3" />
        </motion.span>
        {live ? (
          <>
            <Ticker /> Reasoning
          </>
        ) : (
          'Reasoning'
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="mt-1.5 whitespace-pre-wrap border-l border-line-strong pl-3 text-[13px] leading-relaxed text-fg-2">{text}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TurnHeader({ who, time, agent }: { who: string; time?: number; agent?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      {agent ? <Logo size={18} /> : <span className="flex size-[18px] items-center justify-center rounded-full bg-panel-3 text-[10px] font-semibold text-fg-2">Y</span>}
      <span className="text-[13px] font-medium">{who}</span>
      {time && <span className="font-mono text-[11px] text-fg-3">{new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>}
    </div>
  );
}

function WorkingLine({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 py-1 text-[13px] text-fg-2">
      <Ticker className="text-info" /> Working <span className="font-mono text-[11px] text-fg-3 tabular">{Math.max(0, Math.round((now - since) / 1000))}s</span>
    </motion.div>
  );
}

function AgentTurn({ messages, streaming, working, agentName }: { messages: Message[]; streaming?: Streaming; working: boolean; agentName: string }) {
  const results = useMemo(() => {
    const r: Record<string, { content: string; isError: boolean }> = {};
    for (const m of messages) if (m.role === 'tool' && m.tool_call_id) r[m.tool_call_id] = { content: m.content, isError: m.is_error };
    return r;
  }, [messages]);
  // Consecutive tool-only steps merge into one trace, so a long run reads as a single log.
  const blocks = useMemo(() => {
    const out: ({ kind: 'msg'; m: Message } | { kind: 'trace'; key: string; calls: NonNullable<Message['tool_calls']> })[] = [];
    for (const m of messages) {
      if (m.role === 'tool') continue;
      const calls = m.tool_calls ?? [];
      const last = out[out.length - 1];
      if (m.role === 'assistant' && !m.content && !m.thinking && calls.length && last?.kind === 'trace') {
        last.calls = [...last.calls, ...calls];
        continue;
      }
      out.push({ kind: 'msg', m: { ...m, tool_calls: null } });
      if (calls.length) out.push({ kind: 'trace', key: `t-${m.id}`, calls: [...calls] });
    }
    return out;
  }, [messages]);
  const [since] = useState(Date.now());

  return (
    <div>
      <TurnHeader who={messages.find((m) => m.agent)?.agent ?? streaming?.agent ?? agentName} time={messages[0]?.created_at} agent />
      <div className="pl-[26px]">
        {blocks.map((b) => {
          if (b.kind === 'trace') return <ToolTrace key={b.key} calls={b.calls} results={results} />;
          const m = b.m;
          return m.role === 'error' ? (
            <div key={m.id} className="my-2 flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/5 px-3.5 py-3 text-[13px] text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{m.content}</span>
            </div>
          ) : (
            <div key={m.id}>
              {m.thinking && <Reasoning text={m.thinking} />}
              {m.content && <Markdown text={m.content} />}
            </div>
          );
        })}
        {streaming && (
          <div>
            {streaming.thinking && <Reasoning text={streaming.thinking} live={!streaming.text} />}
            {streaming.text && <Markdown text={streaming.text} streaming />}
          </div>
        )}
        <AnimatePresence>{working && !streaming?.text && !streaming?.thinking && <WorkingLine since={since} />}</AnimatePresence>
      </div>
    </div>
  );
}

export function ChatView({ id }: { id: string }) {
  const messages = useStore((s) => s.messages[id]);
  const streaming = useStore((s) => s.streaming[id]);
  const runState = useStore((s) => s.runs[id]);
  const conversation = useStore((s) => s.conversations.find((c) => c.id === id));
  const agentName = useStore((s) => s.settings?.persona.name ?? 'Sable');
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

  const status = waiting ? (
    <span className="ml-2 hidden items-center gap-1.5 text-[12px] text-accent sm:flex">
      <StatusDot state="waiting" /> awaiting approval
    </span>
  ) : running ? (
    <span className="ml-2 hidden items-center gap-1.5 text-[12px] text-fg-3 sm:flex">
      <StatusDot state="running" /> working
    </span>
  ) : null;

  return (
    <>
      <TopBar
        title={conversation?.title ?? 'Chat'}
        crumbs={conversation?.kind === 'schedule' ? 'Routines' : 'Chats'}
        actions={
          running && (
            <Button size="sm" onClick={() => void stop()}>
              <Square className="size-3 fill-current" /> Stop
            </Button>
          )
        }
      >
        {status}
      </TopBar>
      {notFound ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-fg-2">
          This chat no longer exists.
          <Button size="sm" onClick={() => navigate('/')}>
            Start a new task <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
            }}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto max-w-3xl space-y-8 px-4 pb-10 pt-8 md:px-8">
              {!messages && (
                <div className="flex justify-center py-20">
                  <Spinner />
                </div>
              )}
              {turns.map((t, i) =>
                t.kind === 'user' ? (
                  <motion.div key={t.message.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                    <TurnHeader who={t.message.agent === 'Schedule' ? 'Routine' : 'You'} time={t.message.created_at} />
                    <div className="ml-[26px] whitespace-pre-wrap break-words rounded-lg border border-line bg-panel-2/60 px-3.5 py-2.5 text-[14.5px] leading-relaxed">
                      {t.message.content.replace(/^\[Scheduled task: [^\]]*\]\n/, '')}
                    </div>
                  </motion.div>
                ) : (
                  <AgentTurn key={t.key} messages={t.messages} agentName={agentName} streaming={i === turns.length - 1 ? streaming : undefined} working={running && !waiting && i === turns.length - 1} />
                ),
              )}
              {running && !lastIsAgent && <AgentTurn messages={[]} agentName={agentName} streaming={streaming} working={!waiting} />}

              <AnimatePresence>
                {approvals.map((a) => (
                  <div key={a.id} className="pl-[26px]">
                    <ApprovalCard approval={a} />
                  </div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <AnimatePresence>
            {!pinned && (
              <motion.button
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                onClick={() => {
                  setPinned(true);
                  scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
                }}
                className="absolute bottom-28 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-[12px] text-fg-2 shadow-2"
              >
                <ArrowDown className="size-3.5" /> Latest
              </motion.button>
            )}
          </AnimatePresence>

          <div className={cx('mx-auto w-full max-w-3xl px-3 pb-3 md:px-8 md:pb-5')}>
            <Composer onSend={send} onStop={stop} running={running} autoFocus placeholder={running ? 'Working… you can stop it at any time' : 'Reply or give a new instruction…'} />
          </div>
        </div>
      )}
    </>
  );
}
