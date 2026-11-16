import { AnimatePresence, motion } from 'motion/react';
import {
  Ban, Bell, Brain, CalendarClock, Check, ChevronRight, FileText, Globe, LayoutGrid, ListChecks, Plug, Radar, Search, Terminal, Users, Webhook, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { cx } from '../lib/format';
import { useStore } from '../lib/store';
import type { ToolCall, ToolState } from '../lib/types';
import { Ticker } from './ui';

export function toolIcon(name: string) {
  if (name.startsWith('memory_')) return Brain;
  if (name.startsWith('goal_')) return ListChecks;
  if (name.startsWith('space_')) return LayoutGrid;
  if (name.startsWith('schedule_')) return CalendarClock;
  if (name.startsWith('file_')) return FileText;
  if (name.startsWith('mcp_')) return Plug;
  if (name.startsWith('watch_')) return Radar;
  if (name.startsWith('webhook_')) return Webhook;
  return ({ web_search: Search, web_fetch: Globe, http_request: Webhook, run_script: Terminal, notify: Bell, delegate: Users } as Record<string, typeof Search>)[name] ?? Plug;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

function Glyph({ status }: { status: ToolState['status'] }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {status === 'running' && <Ticker className="text-info text-[13px]" />}
      {status === 'waiting' && <span className="size-1.5 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]" />}
      {status === 'ok' && <Check className="size-3.5 text-ok" strokeWidth={2.4} />}
      {status === 'error' && <X className="size-3.5 text-danger" strokeWidth={2.4} />}
      {(status === 'denied' || status === 'blocked') && <Ban className="size-3.5 text-danger" />}
    </span>
  );
}

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function resolveStatus(live: ToolState | undefined, result: string | undefined, isError: boolean | undefined): ToolState['status'] {
  if (live) return live.status;
  if (result === undefined) return 'running';
  if (!isError) return 'ok';
  if (/denied/i.test(result)) return 'denied';
  if (/^Blocked/.test(result)) return 'blocked';
  return 'error';
}

export function ToolRow({ call, result, isError, depth = 0, title }: { call: ToolCall; result?: string; isError?: boolean; depth?: number; title?: string }) {
  const live = useStore((s) => s.tools[call.id]);
  const children = useStore(useShallow((s) => Object.values(s.tools).filter((t) => t.parentCallId === call.id)));
  const [open, setOpen] = useState(false);
  const status = resolveStatus(live, result, isError);
  const now = useNow(status === 'running' || status === 'waiting');
  const Icon = toolIcon(call.name);
  const label = live?.label ?? call.label ?? call.name;
  const summary = live?.summary ?? call.summary ?? '';
  const output = result ?? live?.preview;
  const elapsed = live ? (live.ended ?? now) - live.started : undefined;

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className={cx('group flex h-8 w-full items-center gap-2.5 pr-3 text-left transition-colors hover:bg-panel-2/70', depth ? 'pl-8' : 'pl-3')}>
        <Glyph status={status} />
        <Icon className="size-3.5 shrink-0 text-fg-3" />
        {title ? (
          <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2 group-hover:text-fg">{title}</span>
        ) : (
          <>
            <span className="shrink-0 text-[13px] text-fg">{label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-3">{summary.replace(label, '').replace(/^[:\s]+/, '') || summary}</span>
          </>
        )}
        {status === 'waiting' && <span className="text-[11.5px] font-medium text-accent">needs approval</span>}
        {(status === 'denied' || status === 'blocked') && <span className="text-[11.5px] text-danger">{status}</span>}
        {elapsed !== undefined && status !== 'waiting' && <span className="font-mono text-[11px] text-fg-3 tabular">{fmtMs(elapsed)}</span>}
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-fg-3 opacity-0 transition-opacity group-hover:opacity-100">
          <ChevronRight className="size-3.5" />
        </motion.span>
      </button>

      {children.length > 0 && (
        <div className="border-l border-line" style={{ marginLeft: 19 }}>
          <div className="pl-3 pt-0.5 text-[11px] text-fg-3">{children[0].agent}</div>
          {children.map((c) => (
            <ToolRow key={c.callId} call={{ id: c.callId, name: c.name, args: c.args ?? {} }} depth={1} />
          ))}
        </div>
      )}
      {status === 'running' && live?.progress && !open && (
        <pre className="mx-3 mb-2 ml-9 max-h-16 overflow-hidden whitespace-pre-wrap font-mono text-[11.5px] text-fg-3 [mask-image:linear-gradient(to_bottom,transparent,black_45%)]">{live.progress.slice(-400)}</pre>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="space-y-2 px-3 pb-3 pl-9 text-[11.5px]">
              <div>
                <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-3">Input</div>
                <pre className="max-h-56 overflow-auto rounded-md border border-line bg-sunken p-2.5 font-mono text-fg-2">{pretty(call.args)}</pre>
              </div>
              {live?.progress && (
                <div>
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-3">Live output</div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken p-2.5 font-mono text-fg-2">{live.progress}</pre>
                </div>
              )}
              {output !== undefined && (
                <div>
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-3">Result</div>
                  <pre className={cx('max-h-72 overflow-auto whitespace-pre-wrap rounded-md border p-2.5 font-mono', isError || status === 'error' ? 'border-danger/25 bg-danger/5 text-danger' : 'border-line bg-sunken text-fg-2')}>{output}</pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A run's tool calls as a compact, expandable trace. */
export function ToolTrace({ calls, results }: { calls: ToolCall[]; results: Record<string, { content: string; isError: boolean }> }) {
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-line bg-panel shadow-1">
      <div className="divide-y divide-line/70">
        {calls.map((c) => (
          <motion.div key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <ToolRow call={c} result={results[c.id]?.content} isError={results[c.id]?.isError} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
