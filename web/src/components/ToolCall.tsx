import { AnimatePresence, motion } from 'motion/react';
import {
  Bell, Brain, CalendarClock, Check, ChevronRight, FileText, Globe, Hourglass, LayoutGrid, ListChecks, Loader2, Plug, Search, ShieldOff, Terminal, Users, Webhook, X,
} from 'lucide-react';
import { useState } from 'react';
import { cx } from '../lib/format';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import type { ToolCall, ToolState } from '../lib/types';

export function toolIcon(name: string) {
  if (name.startsWith('memory_')) return Brain;
  if (name.startsWith('goal_')) return ListChecks;
  if (name.startsWith('space_')) return LayoutGrid;
  if (name.startsWith('schedule_')) return CalendarClock;
  if (name.startsWith('file_')) return FileText;
  if (name.startsWith('mcp_')) return Plug;
  return (
    { web_search: Search, web_fetch: Globe, http_request: Webhook, run_script: Terminal, notify: Bell, delegate: Users } as Record<string, typeof Search>
  )[name] ?? Plug;
}

function StatusIcon({ status }: { status: ToolState['status'] }) {
  const common = 'size-3.5';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={status} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }} className="flex">
        {status === 'running' && <Loader2 className={cx(common, 'animate-spin text-accent')} />}
        {status === 'waiting' && <Hourglass className={cx(common, 'text-warn')} />}
        {status === 'ok' && <Check className={cx(common, 'text-ok')} />}
        {status === 'error' && <X className={cx(common, 'text-danger')} />}
        {(status === 'denied' || status === 'blocked') && <ShieldOff className={cx(common, 'text-danger')} />}
      </motion.span>
    </AnimatePresence>
  );
}

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** One tool call: compact row that expands to show input, output and live progress. */
export function ToolCallRow({ call, result, isError }: { call: ToolCall; result?: string; isError?: boolean }) {
  const live = useStore((s) => s.tools[call.id]);
  const children = useStore(useShallow((s) => Object.values(s.tools).filter((t) => t.parentCallId === call.id)));
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(call.name);

  const status: ToolState['status'] =
    live?.status ?? (result === undefined ? 'running' : isError ? (/denied/i.test(result) ? 'denied' : /Blocked/.test(result) ? 'blocked' : 'error') : 'ok');
  const summary = live?.summary ?? call.summary ?? call.name.replace(/_/g, ' ');
  const output = result ?? live?.preview;
  const statusText = { running: '', waiting: 'Waiting for your OK', ok: '', error: 'Failed', denied: 'Denied', blocked: 'Blocked' }[status];

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-2.5 py-1.5 text-left">
        <span className={cx('relative z-10 flex size-6 shrink-0 items-center justify-center rounded-lg border transition-colors', status === 'waiting' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line bg-surface text-muted group-hover:text-fg')}>
          <Icon className="size-3.5" />
        </span>
        <span className={cx('min-w-0 flex-1 truncate text-[13px]', status === 'running' ? 'shimmer' : 'text-muted group-hover:text-fg')}>{summary}</span>
        {statusText && <span className={cx('text-[11px] font-medium', status === 'waiting' ? 'text-warn' : 'text-danger')}>{statusText}</span>}
        <StatusIcon status={status} />
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="text-subtle">
          <ChevronRight className="size-3.5" />
        </motion.span>
      </button>
      {(live?.progress || children.length > 0) && !open && status === 'running' && (
        <div className="ml-9 mb-1 max-h-20 overflow-hidden text-xs text-subtle font-mono whitespace-pre-wrap [mask-image:linear-gradient(to_bottom,transparent,black_40%)] flex flex-col justify-end">
          {children.length > 0 && <div>{children.map((c) => `› ${c.summary}`).join('\n')}</div>}
          {live?.progress?.slice(-300)}
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 38 }} className="overflow-hidden">
            <div className="ml-9 mb-2 space-y-2 text-xs">
              {children.length > 0 && (
                <div className="rounded-xl border border-line bg-surface/60 px-2.5 py-1">
                  <div className="text-[11px] font-medium text-subtle pt-1">{children[0].agent}'s steps</div>
                  {children.map((c) => (
                    <ToolCallRow key={c.callId} call={{ id: c.callId, name: c.name, args: c.args ?? {} }} />
                  ))}
                </div>
              )}
              <pre className="rounded-xl bg-surface-2 border border-line p-2.5 overflow-x-auto font-mono text-muted max-h-60">{pretty(call.args)}</pre>
              {live?.progress && <pre className="rounded-xl bg-surface-2 border border-line p-2.5 overflow-x-auto font-mono text-muted max-h-60 whitespace-pre-wrap">{live.progress}</pre>}
              {output !== undefined && (
                <pre className={cx('rounded-xl border p-2.5 overflow-x-auto font-mono max-h-72 whitespace-pre-wrap', isError || status === 'error' ? 'bg-danger/5 border-danger/20 text-danger' : 'bg-surface-2 border-line text-muted')}>
                  {output}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ToolCallList({ calls, results }: { calls: ToolCall[]; results: Record<string, { content: string; isError: boolean }> }) {
  return (
    <div className="relative my-1.5">
      <div className="absolute left-3 top-3 bottom-3 w-px bg-line" />
      {calls.map((c) => (
        <motion.div key={c.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <ToolCallRow call={c} result={results[c.id]?.content} isError={results[c.id]?.isError} />
        </motion.div>
      ))}
    </div>
  );
}
