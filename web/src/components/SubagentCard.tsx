import { AnimatePresence, motion } from 'motion/react';
import { Bot, Check, ChevronDown, CircleSlash, Hand, Loader2, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { onServerEvent } from '../lib/store';
import type { Job, JobStep, SubagentCardData } from '../lib/types';
import { Markdown } from './Markdown';

/** A sub-agent job, kept live from the server's job.update events. */
export function useJob(jobId: string, initial?: Job) {
  const [job, setJob] = useState<Job | null>(initial ?? null);
  useEffect(() => {
    if (!initial) void api.get<Job>(`/jobs/${jobId}`).then(setJob).catch(() => {});
    return onServerEvent((ev) => {
      const j = ev.job as Job | undefined;
      if (ev.type === 'job.update' && j?.id === jobId) setJob(j);
    });
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  return job;
}

function elapsed(job: Job, nowMs: number) {
  const s = Math.max(0, Math.round(((job.finished_at ?? nowMs) - job.created_at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StepRow({ step, live }: { step: JobStep; live: boolean }) {
  if (step.k === 'text')
    return <p className="line-clamp-3 whitespace-pre-wrap break-words py-1 pl-6 text-[12.5px] leading-relaxed text-fg-3">{live ? step.text.slice(-400) : step.text.slice(0, 400)}</p>;
  const st = step.status;
  const Icon = !st ? Loader2 : st === 'ok' || st === 'approved' ? Check : st === 'waiting' ? Hand : st === 'denied' || st === 'blocked' ? CircleSlash : X;
  return (
    <div className="flex items-start gap-2 py-1 text-[12.5px]" title={step.preview}>
      <Icon className={cx('mt-0.5 size-3.5 shrink-0', !st && 'animate-spin text-tint', (st === 'ok' || st === 'approved') && 'text-ok', st === 'waiting' && 'text-accent', st === 'error' && 'text-danger', (st === 'denied' || st === 'blocked') && 'text-fg-3')} />
      <span className="min-w-0 flex-1 truncate text-fg-2">{step.summary}</span>
      {st === 'waiting' && <span className="shrink-0 text-[11px] text-accent">needs your OK</span>}
    </div>
  );
}

/** Everything a sub-agent does, right in the chat: its task, live steps, and its result. */
export function SubagentView({ jobId, fallback, initial }: { jobId: string; fallback?: SubagentCardData; initial?: Job }) {
  const job = useJob(jobId, initial);
  const [open, setOpen] = useState<boolean | null>(null);
  const [full, setFull] = useState(false);
  const [nowMs, setNow] = useState(Date.now());
  const running = !job || job.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const showSteps = open ?? running;
  const tools = job?.steps.filter((s) => s.k === 'tool').length ?? 0;
  const name = job?.agent_name ?? fallback?.agent ?? 'Sub-agent';
  const longResult = (job?.result?.length ?? 0) > 900;

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="my-2.5 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-lg', running ? 'bg-tint-soft text-tint' : job?.status === 'done' ? 'bg-ok/10 text-ok' : 'bg-panel-2 text-fg-3')}>
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            <span className="shrink-0">{name}</span>
            <span className="min-w-0 truncate font-normal text-fg-3">{(job?.task ?? fallback?.task ?? '').split('\n')[0]}</span>
            {(job?.background ?? fallback?.background) && <span className="shrink-0 rounded border border-line px-1.5 py-px text-[10.5px] font-normal text-fg-3">background</span>}
          </div>
          <div className="truncate text-[12px] text-fg-3">
            {running ? (
              <span className="inline-flex items-center gap-1 text-tint">
                <Loader2 className="size-3 animate-spin" /> Working · {job ? elapsed(job, nowMs) : '…'}
                {tools ? ` · ${tools} step${tools > 1 ? 's' : ''}` : ''}
              </span>
            ) : job?.status === 'done' ? (
              `Done in ${elapsed(job, nowMs)} · ${tools} step${tools === 1 ? '' : 's'}${job.model ? ` · ${job.model}` : ''}`
            ) : job?.status === 'cancelled' ? (
              'Cancelled'
            ) : (
              <span className="text-danger">Failed</span>
            )}
          </div>
        </div>
        {running && job && (
          <button onClick={() => void api.post(`/jobs/${job.id}/cancel`)} title="Stop this sub-agent" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-fg-3 hover:bg-panel-2 hover:text-danger">
            <Square className="size-3" /> Stop
          </button>
        )}
        <button onClick={() => setOpen(!showSteps)} title={showSteps ? 'Hide steps' : 'Show steps'} className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg">
          <ChevronDown className={cx('size-3.5 transition-transform', showSteps && 'rotate-180')} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showSteps && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-line px-3.5 py-2.5">
              <div className="mb-1.5 text-[11px] font-medium text-fg-3">Task</div>
              <p className="mb-2 line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-2">{job?.task ?? fallback?.task}</p>
              {!!job?.steps.length && (
                <>
                  <div className="mb-0.5 mt-2 text-[11px] font-medium text-fg-3">Steps</div>
                  {(running ? job.steps.slice(-12) : job.steps).map((s, i) => (
                    <StepRow key={s.k === 'tool' ? s.id : `t${i}`} step={s} live={running} />
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {job?.result && !running && (
        <div className="border-t border-line">
          <div className={cx('relative px-3.5 py-2.5', longResult && !full && 'max-h-64 overflow-hidden')}>
            <Markdown text={job.result} className="!text-[13.5px]" />
            {longResult && !full && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--panel)] to-transparent" />}
          </div>
          {longResult && (
            <button onClick={() => setFull(!full)} className="w-full border-t border-line py-1.5 text-[12px] text-fg-3 hover:bg-panel-2 hover:text-fg">
              {full ? 'Show less' : 'Show the full result'}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function SubagentCard({ card }: { card: SubagentCardData }) {
  return <SubagentView jobId={card.jobId} fallback={card} />;
}
