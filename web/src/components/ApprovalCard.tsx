import { motion } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useStore } from '../lib/store';
import type { Approval } from '../lib/types';
import { toolIcon } from './ToolCall';
import { Badge, Button } from './ui';

function argPreview(a: Approval): string | null {
  const args = a.args as Record<string, any>;
  if (a.tool === 'run_script') return String(args.code ?? '');
  if (a.tool === 'http_request') return `${args.method} ${args.url}${args.headers ? `\n${JSON.stringify(args.headers)}` : ''}${args.body ? `\n\n${args.body}` : ''}`;
  if (a.tool === 'web_fetch') return null;
  const json = JSON.stringify(args, null, 2);
  return json === '{}' ? null : json;
}

export function ApprovalCard({ approval, compact, context }: { approval: Approval; compact?: boolean; context?: string }) {
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
      setBusy(null);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="overflow-hidden rounded-lg border border-accent/35 bg-panel shadow-2"
    >
      <div className="flex items-center gap-2 border-b border-accent/20 bg-accent-soft px-3.5 py-2 text-[12px]">
        <ShieldAlert className="size-3.5 text-accent" />
        <span className="font-medium text-accent">Approval required</span>
        <span className="text-fg-3">·</span>
        <span className="text-fg-2">{approval.agent}</span>
        <span className="flex-1" />
        {approval.risk === 'high' && <Badge tone="danger">high impact</Badge>}
        <span className="font-mono text-[11px] text-fg-3">{timeAgo(approval.created_at)}</span>
      </div>
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-fg-2">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="break-words text-[14px] font-medium leading-snug">{approval.summary}</div>
            <div className="mt-0.5 font-mono text-[11.5px] text-fg-3">
              {approval.tool}
              {context ? ` · ${context}` : ''}
            </div>
          </div>
        </div>
        {preview && !compact && <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken p-3 font-mono text-[12px] text-fg-2">{preview}</pre>}
        <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" loading={busy === 'denyfalse'} onClick={() => void decide('deny')}>
            Deny
          </Button>
          <Button size="sm" loading={busy === 'approvetrue'} onClick={() => void decide('approve', true)}>
            {rememberLabel}
          </Button>
          <Button variant="primary" size="sm" loading={busy === 'approvefalse'} onClick={() => void decide('approve')}>
            Approve
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
