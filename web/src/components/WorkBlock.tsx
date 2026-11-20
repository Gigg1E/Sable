import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Brain, Check, ChevronRight, MessageSquareText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { cx } from '../lib/format';
import { useStore } from '../lib/store';
import type { ToolCall, ToolState } from '../lib/types';
import { Markdown } from './Markdown';
import { resolveStatus, ToolRow } from './ToolCall';
import { Ticker } from './ui';

/**
 * Everything an agent does on the way to its answer — reasoning, interim notes and tool calls —
 * folded into one row. Collapsed it shows a live one-line status (or a summary when done);
 * expanded it's a timeline you can drill into.
 */

export type Step =
  | { kind: 'thinking'; id: string; text: string; live?: boolean }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'tool'; id: string; call: ToolCall; result?: string; isError?: boolean };

const host = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, '');
  } catch {
    return String(u ?? '');
  }
};

/** Present-tense, human description of what a tool call is doing. */
export function describeCall(call: ToolCall, label?: string): string {
  const a = call.args as Record<string, any>;
  const n = call.name;
  if (n === 'web_search') return `Searching “${String(a.query ?? '').slice(0, 60)}”`;
  if (n === 'web_fetch') return `Reading ${host(a.url)}`;
  if (n === 'http_request') return `Calling ${host(a.url)}`;
  if (n === 'run_script') return `Running a ${a.language ?? ''} script`.replace('  ', ' ');
  if (n === 'file_write') return `Writing ${a.path}`;
  if (n === 'file_edit') return `Editing ${a.path}`;
  if (n === 'connect_define') return `Setting up the ${a.name} connection`;
  if (n === 'connect_read' || n === 'connect_write') return `Calling ${a.name}`;
  if (n === 'file_read') return `Reading ${a.path}`;
  if (n === 'file_list') return 'Looking through files';
  if (n === 'memory_save') return 'Saving to memory';
  if (n === 'memory_search') return 'Checking memory';
  if (n === 'memory_forget') return 'Forgetting a memory';
  if (n.startsWith('goal_')) return 'Updating the plan';
  if (n.startsWith('space_')) return n === 'space_create' ? `Building “${a.title ?? 'a space'}”` : 'Updating a space';
  if (n === 'watch_test') return `Checking ${host(a.url)}`;
  if (n === 'watch_create') return `Setting up a watcher`;
  if (n.startsWith('webhook_')) return 'Setting up a webhook';
  if (n.startsWith('schedule_')) return 'Scheduling';
  if (n === 'notify') return 'Sending a notification';
  if (n === 'shop_search') return `Searching stores for “${String(a.query ?? '').slice(0, 50)}”`;
  if (n === 'shop_lookup') return 'Matching products on Shop';
  if (n === 'shop_product') return 'Checking sizes and options';
  if (n === 'shop_show') return 'Showing products';
  if (n === 'shop_cart_add') return 'Adding to cart';
  if (n === 'shop_cart_update') return 'Updating the cart';
  if (n === 'shop_cart_view') return 'Opening your carts';
  if (n === 'shop_checkout') return 'Preparing checkout';
  if (n === 'shop_buy') return 'Placing the order';
  if (n === 'shop_orders') return 'Checking your orders';
  if (n === 'delegate') return `Handing off to ${a.agent ?? 'a sub-agent'}`;
  return label ?? n.replace(/_/g, ' ');
}

function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Searched the web, read 3 pages and wrote report.md" — what a finished work row did, in words. */
function describeDone(calls: ToolCall[]) {
  const n = (pred: (c: ToolCall) => boolean) => calls.filter(pred).length;
  const parts: string[] = [];
  const searches = n((c) => c.name === 'web_search');
  const pages = n((c) => c.name === 'web_fetch' || c.name === 'http_request' || c.name === 'watch_test');
  const shop = n((c) => c.name.startsWith('shop_') && c.name !== 'shop_show');
  const scripts = n((c) => c.name === 'run_script');
  const writes = calls.filter((c) => c.name === 'file_write' || c.name === 'file_edit').map((c) => String((c.args as { path?: string }).path ?? '').split('/').pop());
  const reads = n((c) => c.name === 'file_read' || c.name === 'file_list');
  const memory = n((c) => c.name.startsWith('memory_'));
  const calendar = n((c) => c.name.startsWith('calendar_'));
  const shows = n((c) => c.name.startsWith('show_') || c.name === 'shop_show');
  const spaces = n((c) => c.name.startsWith('space_'));
  const conns = calls.filter((c) => c.name.startsWith('connect_')).map((c) => String((c.args as { name?: string }).name ?? '')).filter(Boolean);
  const connLists = n((c) => c.name === 'connect_list');
  const reminders = n((c) => c.name === 'schedule_create');
  const watchers = n((c) => c.name === 'watch_create');
  const agents = calls.filter((c) => c.name === 'delegate').map((c) => String((c.args as { agent?: string }).agent ?? 'a sub-agent'));
  if (searches) parts.push(searches === 1 ? 'searched the web' : `searched the web ${searches} times`);
  if (pages) parts.push(`read ${plural(pages, 'page')}`);
  if (shop) parts.push('checked stores');
  if (calendar) parts.push('checked the calendar');
  if (scripts) parts.push(scripts === 1 ? 'ran a script' : `ran ${scripts} scripts`);
  if (writes.length) parts.push(writes.length <= 2 ? `wrote ${[...new Set(writes)].join(' and ')}` : `wrote ${plural(writes.length, 'file')}`);
  if (reads) parts.push('looked through files');
  if (memory) parts.push('checked memory');
  if (calls.some((c) => c.name === 'connect_define')) parts.push(`set up the ${conns[0]} connection`);
  else if (conns.length) parts.push(`checked ${[...new Set(conns)].join(' and ')}`);
  else if (connLists) parts.push('checked connections');
  if (spaces) parts.push(calls.some((c) => c.name === 'space_create') ? 'built a space' : 'updated a space');
  if (reminders) parts.push(reminders === 1 ? 'set a reminder' : `set ${reminders} reminders`);
  if (watchers) parts.push(watchers === 1 ? 'set up a watcher' : `set up ${watchers} watchers`);
  if (agents.length) parts.push(`asked ${[...new Set(agents)].join(' and ')}`);
  const known = searches + pages + shop + calendar + scripts + writes.length + reads + memory + agents.length + shows + spaces + reminders + watchers + conns.length + connLists;
  if (calls.length - known > 0) parts.push(known ? `${plural(calls.length - known, 'other step')}` : `took ${plural(calls.length, 'step')}`);
  if (!parts.length && shows) parts.push('prepared what to show');
  const text = parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fmtDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function ThinkingStep({ text, live }: { text: string; live?: boolean }) {
  const [full, setFull] = useState(false);
  const long = text.length > 280;
  return (
    <div className="py-1.5 pr-3">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-3">{live ? <Ticker /> : null} Reasoning</div>
      <button onClick={() => long && setFull((f) => !f)} className={cx('block w-full whitespace-pre-wrap text-left text-[13px] leading-relaxed text-fg-2', !full && long && 'line-clamp-3', long && 'cursor-pointer')}>
        {text.trim()}
      </button>
    </div>
  );
}

export function WorkBlock({ steps, working, waiting, started, ended }: { steps: Step[]; working: boolean; waiting: boolean; started: number; ended?: number }) {
  const [open, setOpen] = useState(false);
  const calls = useMemo(() => steps.filter((s): s is Extract<Step, { kind: 'tool' }> => s.kind === 'tool'), [steps]);
  const live = useStore(useShallow((s) => calls.map((c) => s.tools[c.call.id] as ToolState | undefined)));
  const now = useNow(working);

  const statuses = calls.map((c, i) => resolveStatus(live[i], c.result, c.isError));
  const problems = statuses.filter((s) => s === 'error' || s === 'denied' || s === 'blocked').length;
  const thinkingOnly = calls.length === 0;

  // The one-line status while working: the newest unfinished step wins.
  let current = 'Working';
  const runningIdx = statuses.map((s, i) => (s === 'running' || s === 'waiting' ? i : -1)).filter((i) => i >= 0).pop();
  const last = steps[steps.length - 1];
  if (waiting) current = 'Waiting for your approval';
  else if (runningIdx !== undefined) current = describeCall(calls[runningIdx].call, live[runningIdx]?.label ?? calls[runningIdx].call.label);
  else if (last?.kind === 'thinking' && last.live) current = 'Thinking';
  // Between steps, narrate with the agent's own latest note ("Comparing prices at other shops…").
  else if (last?.kind === 'note') current = last.text.replace(/[#*_`>]/g, '').split('\n').find((l) => l.trim())?.trim() ?? 'Thinking';
  else if (working && steps.length) current = 'Thinking';

  const elapsed = (ended ?? now) - started;
  const header = working
    ? current
    : thinkingOnly
      ? `Thought for ${fmtDuration(elapsed)}`
      : describeDone(calls.map((c) => c.call)) || `Worked for ${fmtDuration(elapsed)}`;

  return (
    <div className="my-2">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-2 rounded-md py-1 text-left text-[13px]">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {working ? (
            waiting ? <span className="size-1.5 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]" /> : <Ticker className="text-info" />
          ) : thinkingOnly ? (
            <Brain className="size-3.5 text-fg-3" />
          ) : problems ? (
            <AlertTriangle className="size-3.5 text-danger" />
          ) : (
            <Check className="size-3.5 text-ok" strokeWidth={2.4} />
          )}
        </span>
        <span className="relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={header}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className={cx('block truncate', working ? (waiting ? 'text-accent' : 'text-fg') : 'text-fg-2 group-hover:text-fg')}
            >
              {header}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="hidden shrink-0 font-mono text-[11px] text-fg-3 sm:inline">
          {!working && calls.length > 0 && fmtDuration(elapsed)}
          {!working && problems > 0 && <span className="text-danger"> · {plural(problems, 'issue')}</span>}
          {working && `${calls.length ? `${plural(calls.length, 'step')} · ` : ''}${fmtDuration(elapsed)}`}
        </span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-fg-3">
          <ChevronRight className="size-3.5" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }} className="overflow-hidden">
            <div className="relative ml-2 mt-1 border-l border-line pl-4">
              {steps.map((s) => (
                <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative">
                  <span className={cx('absolute -left-[19.5px] top-[13px] size-[7px] rounded-full border-2 border-bg', s.kind === 'tool' ? 'bg-fg-3' : 'bg-line-strong')} />
                  {s.kind === 'thinking' && <ThinkingStep text={s.text} live={s.live} />}
                  {s.kind === 'note' && (
                    <div className="flex gap-2 py-1.5 pr-3">
                      <MessageSquareText className="mt-1 size-3.5 shrink-0 text-fg-3" />
                      <Markdown text={s.text} className="!text-[13px] text-fg-2 [&_p]:leading-relaxed" />
                    </div>
                  )}
                  {s.kind === 'tool' && (
                    <div className="-ml-3 overflow-hidden rounded-md">
                      <ToolRow call={s.call} title={describeCall(s.call, s.call.label)} result={s.result} isError={s.isError} />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
