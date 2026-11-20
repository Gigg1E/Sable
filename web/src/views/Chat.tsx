import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowDown, ArrowRight, CalendarClock, ChevronRight, LayoutGrid, ListChecks, Plane, PanelRightClose, PanelRightOpen, Search, Square, X, Sparkle } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ApprovalCard } from '../components/ApprovalCard';
import { Composer, type ComposerHandle } from '../components/Composer';
import { Logo } from '../components/Logo';
import { Markdown, StreamingMarkdown } from '../components/Markdown';
import { WorkBlock, type Step } from '../components/WorkBlock';
import { CardView, ChatId, FileGlyph, fmtBytes, ShownFiles } from '../components/Cards';
import { Button, Card, CopyButton, IconButton, Page, Progress, SectionLabel, Spinner, StatusDot, Ticker, TopBar } from '../components/ui';
import { api } from '../lib/api';
import { clockTime, cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore, type Streaming } from '../lib/store';
import { useQueue } from '../lib/queue';
import { usePanel } from '../lib/panel';
import { SidePanel, usePanelAutoOpen } from '../components/SidePanel';
import type { AnyCard, Goal, Job, Message, Schedule, Watcher } from '../lib/types';
import { SubagentView } from '../components/SubagentCard';
import { Signature } from '../components/Signature';
import { Sparkline } from '../components/Sparkline';
import { ImageViewer } from '../components/ImageViewer';
import { imageUrl } from '../lib/images';

export async function startChat(text: string, attachments: string[] = []) {
  const { id } = await api.post<{ id: string }>('/conversations');
  useStore.setState((s) => ({ messages: { ...s.messages, [id]: [] } }));
  navigate(`/chat/${id}`);
  try {
    await api.post(`/conversations/${id}/messages`, { text, attachments });
  } catch (err) {
    useStore.getState().toast({ title: 'Could not send', body: (err as Error).message, tone: 'error' });
  }
}

/** Home's quick way into Main: its latest message and how many open loops it's holding. */
function MainCard() {
  const main = useStore((s) => s.conversations.find((c) => c.kind === 'main'));
  const running = useStore((s) => (main ? !!s.runs[main.id] : false));
  const [loops, setLoops] = useState<number | null>(null);
  useEffect(() => {
    const load = () => void api.get<{ open: unknown[] }>('/journal').then((r) => setLoops(r.open.length)).catch(() => {});
    load();
    return onServerEvent((ev) => ev.type === 'journal.changed' && load());
  }, []);
  if (!main) return null;
  const preview = (main as { preview?: string | null }).preview?.replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim();
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      onClick={() => navigate(`/chat/${main.id}`)}
      className="group mt-8 flex w-full items-center gap-3.5 rounded-xl border border-line bg-panel px-4 py-3.5 text-left shadow-1 transition-colors hover:border-line-strong"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
        {running ? <StatusDot state="running" /> : <Sparkle className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">Main</span>
        <span className="block truncate text-[12.5px] text-fg-3">{preview || 'Your permanent chat with Sable: the big picture, the journal and open loops.'}</span>
      </span>
      {loops ? (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2 py-1 text-[12px] text-accent sm:inline-flex">
          {loops} open loop{loops === 1 ? '' : 's'}
        </span>
      ) : null}
      <ArrowRight className="size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
    </motion.button>
  );
}

// ───────────────────────── Home ─────────────────────────

const STARTERS = [
  { icon: Search, label: 'Research', text: 'Research ' },
  { icon: LayoutGrid, label: 'Build a space', text: 'Build me a space that ' },
  { icon: CalendarClock, label: 'Schedule a routine', text: 'Every weekday at 8:00, ' },
  { icon: Plane, label: 'Plan something', text: 'Help me plan ' },
];

export function ChatHome({ into }: { into?: string } = {}) {
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
  // Recent conversations you had (automation runs live in their own sidebar section).
  const recent = conversations.filter((c) => !runs[c.id] && !['schedule', 'watch', 'hook', 'main'].includes(c.kind)).slice(0, 6);

  return (
    <>
      <TopBar title="Home" />
      <Page width="md">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">What should {name} take on?</h1>
          <p className="mt-1 text-[13.5px] text-fg-2">Describe an outcome. It plans the steps, asks before anything sensitive, and keeps working in the background.</p>
          <div className="mt-5">
            <Composer ref={composer} onSend={into ? (text, attachments) => void api.post(`/conversations/${into}/messages`, { text, attachments }).catch((err) => useStore.getState().toast({ title: 'Could not send', body: (err as Error).message, tone: 'error' })) : startChat} autoFocus minRows={2} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button key={s.label} onClick={() => composer.current?.setText(s.text)} className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[12.5px] text-fg-2 shadow-1 transition-colors hover:border-line-strong hover:text-fg">
                <s.icon className="size-3.5 text-fg-3" /> {s.label}
              </button>
            ))}
          </div>
        </motion.div>

        <MainCard />

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
                  <span className="text-[11.5px] tabular-nums text-fg-3">{runs[c.id]?.status === 'waiting' ? 'awaiting approval' : 'running'}</span>
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
                      <div className="truncate text-[13.5px]">{c.title.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '')}</div>
                      {c.preview && <div className="mt-0.5 truncate text-[12.5px] text-fg-3">{c.preview.replace(/[#*_`>]/g, '')}</div>}
                    </div>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-fg-3">{timeAgo(c.updated_at)}</span>
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
                    <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-fg-3 sm:w-[118px]">{clockTime(s.next_run!).replace(/^\w+, /, '')}</span>
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

const SHOW_TOOLS = /^(show_links|show_images|show_file|shop_show)$/;

type Segment = { kind: 'note'; id: string; text: string } | { kind: 'cards'; id: string; cards: AnyCard[] } | { kind: 'work'; id: string; steps: Step[]; start: number; end?: number };

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

function TurnHeader({ who, time, agent }: { who: string; time?: number; agent?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      {agent ? <Logo size={18} /> : <span className="flex size-[18px] items-center justify-center rounded-full bg-panel-3 text-[10px] font-semibold text-fg-2">Y</span>}
      <span className="text-[13px] font-medium">{who}</span>
      {time && <span className="text-[11.5px] tabular-nums text-fg-3">{new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>}
    </div>
  );
}

function AgentTurn({ messages, streaming, working, waiting, agentName }: { messages: Message[]; streaming?: Streaming; working: boolean; waiting: boolean; agentName: string }) {
  const [since] = useState(Date.now());

  // Split the turn, in order, into what the agent said along the way ("Let me look that up…"),
  // folded work rows (reasoning and tool calls between those notes) and the final answer.
  const { segments, final, errors, shownFiles } = useMemo(() => {
    const results: Record<string, { content: string; isError: boolean; cards: AnyCard[] }> = {};
    for (const m of messages) if (m.role === 'tool' && m.tool_call_id) results[m.tool_call_id] = { content: m.content, isError: m.is_error, cards: m.cards ?? [] };
    const shownFiles = new Set<string>();
    const assistant = messages.filter((m) => m.role === 'assistant');
    const lastMsg = assistant[assistant.length - 1];
    // The answer is the last assistant message once it stops calling tools (and nothing is still streaming).
    const finalMsg = lastMsg && !lastMsg.tool_calls?.length && lastMsg.content ? lastMsg : null;
    const segs: Segment[] = [];
    const work = (at: number) => {
      const last = segs[segs.length - 1];
      if (last?.kind === 'work') return last;
      const seg: Segment = { kind: 'work', id: `w-${segs.length}`, steps: [], start: at };
      segs.push(seg);
      return seg;
    };
    for (const m of assistant) {
      if (m.thinking?.trim()) work(m.created_at).steps.push({ kind: 'thinking', id: `th-${m.id}`, text: m.thinking });
      if (m === finalMsg) continue;
      if (m.content?.trim()) {
        const last = segs[segs.length - 1];
        if (last?.kind === 'work') last.end = m.created_at;
        segs.push({ kind: 'note', id: `n-${m.id}`, text: m.content });
      }
      for (const c of m.tool_calls ?? []) {
        work(m.created_at).steps.push({ kind: 'tool', id: c.id, call: c, result: results[c.id]?.content, isError: results[c.id]?.isError });
        // What a tool shows (products, links, pictures, files) appears right after the step that made it.
        // A file appears once per turn and stays live, so repeated edits don't pile up cards.
        const cards = (results[c.id]?.cards ?? []).filter((card) => card.type !== 'file' || !shownFiles.has(card.path));
        for (const card of cards) if (card.type === 'file') shownFiles.add(card.path);
        if (cards.length) {
          const last = segs[segs.length - 1];
          if (last?.kind === 'work') last.end = m.created_at;
          segs.push({ kind: 'cards', id: `c-${c.id}`, cards });
        }
      }
    }
    return { segments: segs, final: finalMsg, errors: messages.filter((m) => m.role === 'error'), shownFiles };
  }, [messages, working]);

  const started = messages[0]?.created_at ?? since;
  const ended = messages[messages.length - 1]?.created_at;
  // While working (and not streaming text), the newest segment must be a live work row.
  const live: Segment[] = [...segments];
  if (working && !streaming?.text) {
    const last = live[live.length - 1];
    const liveThought: Step[] = streaming?.thinking ? [{ kind: 'thinking', id: `live-${streaming.messageId}`, text: streaming.thinking, live: true }] : [];
    if (last?.kind === 'work') live[live.length - 1] = { ...last, steps: [...last.steps, ...liveThought], end: undefined };
    else live.push({ kind: 'work', id: `w-${live.length}`, steps: liveThought, start: ended ?? started });
  }

  return (
    <ChatId.Provider value={messages[0]?.conversation_id ?? ''}>
    <ShownFiles.Provider value={shownFiles}>
      <TurnHeader who={messages.find((m) => m.agent)?.agent ?? streaming?.agent ?? agentName} time={messages[0]?.created_at} agent />
      <div className="pl-[26px]">
        {live.map((seg, i) => {
          const isLast = i === live.length - 1;
          if (seg.kind === 'note') return <Markdown key={seg.id} text={seg.text} className="my-1.5" />;
          if (seg.kind === 'cards') return <div key={seg.id}>{seg.cards.map((c, j) => <CardView key={j} card={c} />)}</div>;
          const active = working && isLast && !streaming?.text;
          // A row that only prepared cards (show_links, show_file…) adds nothing: the cards are right below it.
          if (!active && seg.steps.length && seg.steps.every((s) => s.kind === 'tool' && SHOW_TOOLS.test(s.call.name) && !s.isError)) return null;
          return <WorkBlock key={seg.id} steps={seg.steps} working={active} waiting={active && waiting} started={seg.start} ended={active ? undefined : (seg.end ?? ended)} />;
        })}
        {final && (
          <div className="group/answer">
            <Markdown text={final.content} />
            {!working && (
              <div className="-ml-1.5 mt-1 flex opacity-100 transition-opacity sm:opacity-0 sm:group-hover/answer:opacity-100 sm:focus-within:opacity-100">
                <CopyButton text={final.content} label="Copy answer" showLabel />
              </div>
            )}
          </div>
        )}
        {streaming?.text && <StreamingMarkdown text={streaming.text} />}
        {errors.map((m) => (
          <div key={m.id} className="my-2 flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger/5 px-3.5 py-3 text-[13px] text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{m.content}</span>
          </div>
        ))}
      </div>
    </ShownFiles.Provider>
    </ChatId.Provider>
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
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    setNotFound(false);
    loadConversation(id).catch(() => setNotFound(true));
  }, [id, loadConversation]);

  const turns = useMemo(() => groupTurns(messages ?? []), [messages]);
  // Sub-agents still working whose card isn't in the chat yet (the ones Sable is waiting on).
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    const load = () => void api.get<Job[]>(`/jobs?conversationId=${id}`).then(setJobs).catch(() => {});
    load();
    return onServerEvent((ev) => {
      if (ev.type === 'job.update' && ev.conversationId === id) setJobs((cur) => [ev.job as Job, ...cur.filter((j) => j.id !== (ev.job as Job).id)]);
    });
  }, [id]);
  const shownJobs = useMemo(() => new Set((messages ?? []).flatMap((m) => (m.cards ?? []).filter((c) => c.type === 'subagent').map((c) => (c as { jobId: string }).jobId))), [messages]);
  const liveJobs = jobs.filter((j) => j.status === 'running' && !shownJobs.has(j.id)).sort((a, b) => a.created_at - b.created_at);
  const running = !!runState;
  const waiting = runState?.status === 'waiting' || approvals.length > 0;
  const lastIsAgent = turns[turns.length - 1]?.kind === 'agent';

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text, streaming?.thinking, approvals.length, pinned, running]);

  async function send(text: string, attachments: string[]) {
    try {
      setPinned(true);
      await api.post(`/conversations/${id}/messages`, { text, attachments });
    } catch (err) {
      toast({ title: 'Could not send', body: (err as Error).message, tone: 'error' });
    }
  }
  const panelOpen = usePanel((s) => s.open);
  const setPanel = usePanel((s) => s.set);
  usePanelAutoOpen(id);
  const queue = useQueue((s) => s.queues[id]) ?? [];
  const queueAdd = useQueue((s) => s.add);
  const queueRemove = useQueue((s) => s.remove);
  async function interjectNow(text: string) {
    try {
      setPinned(true);
      const r = await api.post<{ interjected: boolean }>(`/conversations/${id}/interject`, { text });
      if (r.interjected) toast({ title: 'Added to the current task', body: "It'll be picked up after the current step." });
    } catch (err) {
      toast({ title: 'Could not send', body: (err as Error).message, tone: 'error' });
    }
  }
  // Queued messages go out one at a time, each after the previous run fully finishes.
  const sendingQueued = useRef(false);
  useEffect(() => {
    if (running || !queue.length || sendingQueued.current) return;
    const next = useQueue.getState().take(id);
    if (!next) return;
    sendingQueued.current = true;
    void send(next.text, next.attachments).finally(() => setTimeout(() => (sendingQueued.current = false), 400));
  }, [running, queue.length, id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        title={conversation?.kind === 'main' ? 'Main' : (conversation?.title ?? 'Chat').replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '')}
        crumbs={conversation?.kind === 'main' ? undefined : ({ schedule: 'Routine', watch: 'Watcher', hook: 'Webhook' }[conversation?.kind ?? ''] ?? 'Chats')}
        actions={
          <>
            {running && (
              <Button size="sm" onClick={() => void stop()}>
                <Square className="size-3 fill-current" /> Stop
              </Button>
            )}
            <IconButton label={panelOpen ? 'Hide the side panel' : conversation?.kind === 'main' ? 'Journal, files and reminders' : 'Files, spaces and reminders'} onClick={() => setPanel({ open: !panelOpen, full: false })} className={cx(panelOpen && 'text-tint')}>
              {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </IconButton>
          </>
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
        <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
                    {WAKE.test(t.message.content) ? (
                      <WakeLine text={t.message.content} />
                    ) : (
                      <>
                    <TurnHeader who={t.message.agent === 'Schedule' ? 'Routine' : 'You'} time={t.message.created_at} />
                    {!!t.message.attachments?.length && (
                      <div className="mb-2 ml-[26px] flex flex-wrap gap-2">
                        {t.message.attachments.map((a) =>
                          a.kind === 'file' ? (
                            <a key={a.id} href={imageUrl(a.id)} download={a.name} className="flex h-14 max-w-[260px] items-center gap-2.5 rounded-lg border border-line bg-panel-2 px-2.5 transition-colors hover:border-line-strong">
                              <FileGlyph name={a.name ?? 'file'} />
                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-medium">{a.name}</span>
                                <span className="block text-[11.5px] tabular-nums text-fg-3">{fmtBytes(a.size ?? 0)}</span>
                              </span>
                            </a>
                          ) : (
                          <motion.button key={a.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} onClick={() => setViewing(a.id)} className="block overflow-hidden rounded-lg border border-line bg-panel-2 transition-opacity hover:opacity-90">
                            <img
                              src={imageUrl(a.id)}
                              alt=""
                              loading="lazy"
                              className={cx('block w-auto max-w-[min(360px,80vw)] object-contain', t.message.attachments!.length > 1 ? 'max-h-32' : 'max-h-64')}
                              style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}
                            />
                          </motion.button>
                          ),
                        )}
                      </div>
                    )}
                    {t.message.content && (
                      <div className="ml-[26px] whitespace-pre-wrap break-words rounded-lg border border-tint/15 bg-tint-soft px-3.5 py-2.5 text-[14.5px] leading-relaxed">
                        {t.message.content.replace(/^\[Scheduled task: [^\]]*\]\n/, '')}
                      </div>
                    )}
                      </>
                    )}
                  </motion.div>
                ) : (
                  <AgentTurn key={t.key} messages={t.messages} agentName={agentName} streaming={i === turns.length - 1 ? streaming : undefined} working={running && i === turns.length - 1} waiting={waiting && i === turns.length - 1} />
                ),
              )}
              {running && !lastIsAgent && <AgentTurn messages={[]} agentName={agentName} streaming={streaming} working waiting={waiting} />}
              {liveJobs.length > 0 && (
                <div className="space-y-0 pl-[26px]">
                  {liveJobs.map((j) => (
                    <SubagentView key={j.id} jobId={j.id} initial={j} />
                  ))}
                </div>
              )}

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

          <ImageViewer id={viewing} onClose={() => setViewing(null)} />
          <div className={cx('mx-auto w-full max-w-3xl px-3 pb-3 md:px-8 md:pb-5')}>
            <AnimatePresence initial={false}>
              {queue.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="mb-2 overflow-hidden rounded-lg border border-line bg-panel shadow-1">
                  <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11.5px] text-fg-3">
                    <span>
                      Queued · sends {running ? 'when this task finishes' : 'now'}
                    </span>
                    <span className="font-mono">{queue.length}</span>
                  </div>
                  {queue.map((q, i) => (
                    <motion.div key={q.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group flex items-center gap-2 px-3 py-1.5 text-[13px]">
                      <span className="w-4 shrink-0 text-[11.5px] tabular-nums text-fg-3">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-fg-2">{q.text || `${q.attachments.length} attachment${q.attachments.length === 1 ? '' : 's'}`}</span>
                      {running && q.text && !q.attachments.length && (
                        <button onClick={() => (queueRemove(id, q.id), void interjectNow(q.text))} className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-fg-3 opacity-100 transition-opacity hover:bg-panel-2 hover:text-fg sm:opacity-0 sm:group-hover:opacity-100">
                          Interject now
                        </button>
                      )}
                      <button onClick={() => queueRemove(id, q.id)} aria-label="Remove from queue" className="shrink-0 rounded p-0.5 text-fg-3 hover:bg-panel-2 hover:text-fg">
                        <X className="size-3.5" />
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <Composer
              onSend={send}
              onStop={stop}
              onQueue={(text, attachments) => queueAdd(id, { text, attachments })}
              onInterject={(text) => void interjectNow(text)}
              running={running}
              autoFocus
              placeholder={running ? 'Queue a follow-up… (Ctrl+Enter adds it to the current task)' : 'Reply or give a new instruction…'}
            />
          </div>
        </div>
        <SidePanel conversationId={id} messages={messages ?? []} />
        </div>
      )}
    </>
  );
}

/** Messages that wake a chat on their own: background results, follow-ups, watchers, webhooks. */
const WAKE = /^\[(Sub-agent [^\]]*|Follow-up you scheduled: [^\]]*|Watcher triggered: [^\]]*|Webhook received: [^\]]*|Scheduled task: [^\]]*|Email from you: [^\]]*)\]/;

/** A wake-up shown as one slim line with its signature, since what happens next is Sable's reply. */
function WakeLine({ text }: { text: string }) {
  const head = WAKE.exec(text)?.[1] ?? '';
  let kind = 'agent';
  let label = head;
  if (head.startsWith('Sub-agent')) {
    const m = /^Sub-agent ([^:]+): ([^·]+)/.exec(head);
    label = `${m?.[2]?.trim() ?? 'Sub-agent'} ${m?.[1] ?? 'reported back'} · result handed back`;
  } else if (head.startsWith('Follow-up')) {
    kind = 'reminder';
    label = `Following up: ${head.replace(/^Follow-up you scheduled: /, '').replace(/ · \S+$/, '')}`;
  } else if (head.startsWith('Watcher')) {
    kind = 'watch';
    label = `${head.replace(/^Watcher triggered: /, '').replace(/ · \S+$/, '')} fired`;
  } else if (head.startsWith('Email from you')) {
    kind = 'mail';
    label = `Email: ${head.replace(/^Email from you: /, '').replace(/ · \S+$/, '')}`;
  } else if (head.startsWith('Scheduled task')) {
    kind = 'schedule';
    label = head.replace(/^Scheduled task: /, '').replace(/ · \S+$/, '');
  } else if (head.startsWith('Webhook')) {
    kind = 'hook';
    label = `${head.replace(/^Webhook received: /, '')} called in`;
  }
  return (
    <div className="flex items-center gap-2 pl-[26px] text-[12.5px] text-fg-3">
      <Signature kind={kind} size={20} />
      <span className="truncate">{label}</span>
    </div>
  );
}
