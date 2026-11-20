import { motion } from 'motion/react';
import { CalendarClock, CreditCard, Plug, Radar, ShieldAlert } from 'lucide-react';
import { cx } from '../lib/format';
import { useState } from 'react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useStore } from '../lib/store';
import type { Approval } from '../lib/types';
import { toolIcon } from './ToolCall';
import { CartCard, money } from './CommerceCards';
import type { AutomationCard, CartLikeCard, ConnectionCard } from '../lib/types';
import { AUTH_LABEL } from './Connections';
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
  const [checked, setChecked] = useState(false);
  const [method, setMethod] = useState<string | null>(null);
  const automation = approval.preview?.type === 'automation' ? (approval.preview as AutomationCard) : null;
  const connection = approval.preview?.type === 'connection' ? (approval.preview as ConnectionCard) : null;
  const purchase = approval.preview && approval.preview.type !== 'products' && !automation && !connection ? (approval.preview as CartLikeCard) : null;

  async function decide(decision: 'approve' | 'deny', remember = false, choice?: string) {
    setBusy(decision + remember + (choice ?? ''));
    try {
      const r = await api.post<{ status: string }>(`/approvals/${approval.id}/decision`, { decision, remember, ...(choice ?? method ? { choice: choice ?? method } : {}) });
      useStore.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== approval.id) }));
      // The task that asked is gone (Sable restarted, or the task was stopped): say so instead of pretending.
      if (r?.status === 'expired') toast({ title: 'That request had already expired', body: 'The task that asked is no longer running (Sable restarted or it was stopped). Ask again and approve the new request.', tone: 'error' });
    } catch (err) {
      toast({ title: 'Could not record decision', body: (err as Error).message, tone: 'error' });
      setBusy(null);
    }
  }

  if (connection) {
    const c = connection;
    return (
      <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden rounded-lg border border-tint/35 bg-panel shadow-2">
        <div className="flex items-center gap-2 border-b border-tint/20 bg-tint-soft px-3.5 py-2 text-[12px]">
          <Plug className="size-3.5 text-tint" />
          <span className="font-semibold text-tint">{c.change ? 'Change connection' : 'New connection'}</span>
          <span className="text-fg-3">·</span>
          <span className="truncate text-fg-2">{approval.agent} built this from the API docs</span>
        </div>
        <div className="space-y-3 p-3.5 text-[13px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-[15px] font-semibold">{c.name}</span>
            <span className="text-fg-2">{c.purpose}</span>
          </div>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 rounded-md border border-line bg-sunken px-3 py-2.5 text-[12.5px]">
            <dt className="text-fg-3">Server</dt>
            <dd className="break-all font-mono">{c.baseUrl}</dd>
            <dt className="text-fg-3">Sign-in</dt>
            <dd>
              {AUTH_LABEL[c.auth.style]}
              {c.auth.header ? ` (${c.auth.header})` : c.auth.param ? ` (?${c.auth.param}=)` : c.auth.region ? ` (${c.auth.service}, ${c.auth.region})` : ''}
            </dd>
            <dt className="text-fg-3">Runs freely</dt>
            <dd>{c.readMethods.join(', ')} (reading)</dd>
            <dt className="text-fg-3">Asks you</dt>
            <dd>{['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => !c.readMethods.includes(m)).join(', ') || 'nothing'}</dd>
            {c.docsUrl && (
              <>
                <dt className="text-fg-3">Docs</dt>
                <dd className="truncate">
                  <a href={c.docsUrl} target="_blank" rel="noopener noreferrer" className="text-tint underline underline-offset-2">
                    {c.docsUrl.replace(/^https?:\/\//, '')}
                  </a>
                </dd>
              </>
            )}
          </dl>
          {c.readMethods.some((m) => !['GET', 'HEAD', 'OPTIONS'].includes(m)) && <p className="text-[12.5px] text-accent">{c.readMethods.filter((m) => !['GET', 'HEAD', 'OPTIONS'].includes(m)).join(', ')} counts as reading for this API, so pair it with a read-only key.</p>}
          {c.credentialHelp && (
            <p className="text-[12.5px] leading-relaxed text-fg-2">
              <b className="text-fg">Key to create:</b> {c.credentialHelp}
            </p>
          )}
          {c.dropsCredential && <p className="text-[12.5px] text-accent">This changes where the connection points, so its stored key will be removed.</p>}
          <p className="text-[12px] text-fg-3">After you approve, you'll enter the key in a secure field. The AI never sees it, and it's only sent to this server.</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" loading={busy === 'denyfalse'} onClick={() => void decide('deny')}>
              Don't create
            </Button>
            <Button variant="primary" size="sm" loading={busy === 'approvefalse'} onClick={() => void decide('approve')}>
              {c.change ? 'Save changes' : 'Create connection'}
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (automation) {
    return (
      <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden rounded-lg border border-tint/35 bg-panel shadow-2">
        <div className="flex items-center gap-2 border-b border-tint/20 bg-tint-soft px-3.5 py-2 text-[12px]">
          {automation.kind === 'routine' ? <CalendarClock className="size-3.5 text-tint" /> : <Radar className="size-3.5 text-tint" />}
          <span className="font-semibold text-tint">{automation.kind === 'routine' ? 'New routine' : 'New watcher'}</span>
          <span className="text-fg-3">·</span>
          <span className="truncate text-fg-2">{approval.agent} wants to set this up</span>
        </div>
        <div className="space-y-3 p-3.5 text-[13px]">
          <div>
            <div className="text-[15px] font-semibold">{automation.title}</div>
            <div className="mt-0.5 text-fg-2">
              {automation.when}
              {automation.source ? ` · ${automation.source}` : ''}
              {automation.notify === 'when_new' ? ' · tells you only when something new happens' : ''}
            </div>
          </div>
          <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
            <div className="mb-1 text-[11.5px] text-fg-3">{automation.kind === 'routine' ? 'Each time it runs, it will' : 'When it fires, it will'}</div>
            <p className="whitespace-pre-wrap leading-relaxed">{automation.prompt}</p>
          </div>
          <p className="text-[12.5px] leading-relaxed text-fg-2">
            <b className="text-fg">Approve</b> lets its runs take these steps without asking you again{automation.restrict.length ? <>, except <b className="text-fg">{automation.restrict.join(', ')}</b></> : ''}. Purchases always ask. Choose <b className="text-fg">Ask me each time</b> to approve its actions as they happen.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" loading={busy === 'denyfalse'} onClick={() => void decide('deny')}>
              Don't set up
            </Button>
            <Button size="sm" loading={busy === 'approvefalseask'} onClick={() => void decide('approve', false, 'ask')}>
              Ask me each time
            </Button>
            <Button variant="primary" size="sm" loading={busy === 'approvefalseauto'} onClick={() => void decide('approve', false, 'auto')}>
              Approve
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (purchase) {
    const total = purchase.totals.find((t) => t.type === 'total');
    return (
      <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden rounded-lg border border-danger/40 bg-panel shadow-2">
        <div className="flex items-center gap-2 border-b border-danger/25 bg-danger/8 px-3.5 py-2 text-[12px]">
          <ShieldAlert className="size-3.5 text-danger" />
          <span className="font-semibold text-danger">Confirm purchase</span>
          <span className="text-fg-3">·</span>
          <span className="text-fg-2">{approval.agent} wants to place a real order</span>
        </div>
        <div className="space-y-3 p-3.5">
          <CartCard card={purchase} compact />
          <div className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-2">
            <b className="text-fg">This charges your card and can't be undone from here.</b> The items, prices, address and total above come straight from the store, but AI agents can misunderstand what you asked for. Check the
            item, size/color, quantity, address and total before you approve. Returns follow the store's own policy.
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-fg-2">Pay with</div>
            <div className="space-y-1.5">
              {purchase.instruments.map((i) => (
                <label key={i.id} className={cx('flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] transition-colors', method === i.id ? 'border-fg/50 bg-panel-2' : 'border-line hover:border-line-strong')}>
                  <input type="radio" name={`pay-${approval.id}`} checked={method === i.id} onChange={() => setMethod(i.id)} className="size-4 accent-[var(--fg)]" />
                  <CreditCard className="size-4 text-fg-3" />
                  {i.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 accent-[var(--fg)]" />
            <span>I've checked the item, quantity, delivery address and total.</span>
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" loading={busy === 'denyfalse'} onClick={() => void decide('deny')}>
              Don't buy
            </Button>
            <Button variant="primary" size="sm" disabled={!checked || !method} loading={busy === 'approvefalse'} onClick={() => void decide('approve')}>
              Place order{total ? ` · ${money({ amount: total.amount, currency: purchase.currency })}` : ''}
            </Button>
          </div>
        </div>
      </motion.div>
    );
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
        <span className="text-[11.5px] tabular-nums text-fg-3">{timeAgo(approval.created_at)}</span>
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
          {!approval.alwaysAsk && (
            <Button size="sm" loading={busy === 'approvetrue'} onClick={() => void decide('approve', true)}>
              {rememberLabel}
            </Button>
          )}
          <Button variant="primary" size="sm" loading={busy === 'approvefalse'} onClick={() => void decide('approve')}>
            Approve
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
