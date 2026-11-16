import { motion } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { useStore } from '../lib/store';
import type { Approval } from '../lib/types';
import { toolIcon } from './ToolCall';
import { Button } from './ui';

function argPreview(a: Approval): string | null {
  const args = a.args as Record<string, any>;
  if (a.tool === 'run_script') return String(args.code ?? '');
  if (a.tool === 'http_request') return `${args.method} ${args.url}${args.body ? `\n\n${args.body}` : ''}`;
  if (a.tool === 'web_fetch') return null;
  const json = JSON.stringify(args, null, 2);
  return json === '{}' ? null : json;
}

export function ApprovalCard({ approval, compact }: { approval: Approval; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useStore((s) => s.toast);
  const Icon = toolIcon(approval.tool);
  const preview = argPreview(approval);
  const rememberLabel = approval.scope?.kind === 'domain' ? `Always allow ${approval.scope.value}` : 'Always allow';

  async function decide(decision: 'approve' | 'deny', remember = false) {
    setBusy(decision + remember);
    try {
      await api.post(`/approvals/${approval.id}/decision`, { decision, remember });
      useStore.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== approval.id) }));
    } catch (err) {
      toast({ title: 'Could not record decision', body: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="relative rounded-2xl p-[1px] overflow-hidden"
    >
      <motion.div
        className="absolute inset-[-50%]"
        style={{ background: 'conic-gradient(from 0deg, transparent 0 60%, var(--accent-2) 75%, var(--accent) 85%, transparent 100%)' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
      />
      <div className="relative rounded-[15px] bg-surface p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warn/10 text-warn">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-warn">
              <ShieldAlert className="size-3.5" /> {approval.agent} wants to
            </div>
            <div className="mt-0.5 font-medium text-[15px] leading-snug break-words">{approval.summary}</div>
            {approval.risk === 'high' && <div className="mt-1 text-xs text-muted">This can change things outside Sable. Check it before you approve.</div>}
          </div>
        </div>
        {preview && !compact && (
          <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-surface-2 border border-line p-3 text-xs font-mono text-muted whitespace-pre-wrap">{preview}</pre>
        )}
        <div className={cx('mt-3.5 flex flex-wrap gap-2', compact && 'mt-3')}>
          <Button variant="primary" size="sm" loading={busy === 'approvefalse'} onClick={() => decide('approve')}>
            Approve
          </Button>
          <Button size="sm" loading={busy === 'approvetrue'} onClick={() => decide('approve', true)}>
            {rememberLabel}
          </Button>
          <Button variant="ghost" size="sm" loading={busy === 'denyfalse'} onClick={() => decide('deny')}>
            Deny
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
