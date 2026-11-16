import { all, get, run } from '../db.js';
import { emit } from '../events.js';
import { notify } from '../push.js';
import { getSettings, updateSettings } from '../settings.js';
import { id, now, parseJson } from '../util.js';
import type { ToolDef, ToolScope } from './tools/registry.js';

/**
 * The Sentinel decides, for every tool call, whether it runs, needs the user's OK, or is blocked.
 * Policies are per tool (auto / ask / deny); web tools are additionally scoped by domain so the
 * user can say "always allow example.com" instead of approving every page.
 */

export type Decision = { action: 'allow' | 'ask' | 'deny'; reason: string; scope?: ToolScope };

export function domainMatches(host: string, list: string[]) {
  return list.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^\*\./, '');
    return dom && (host === dom || host.endsWith('.' + dom));
  });
}

export function policyFor(tool: ToolDef) {
  return getSettings().policies[tool.name] ?? tool.defaultPolicy;
}

export function decide(tool: ToolDef, args: Record<string, unknown>): Decision {
  const s = getSettings();
  const scope = tool.scope?.(args as Record<string, any>);
  if (scope?.kind === 'domain' && domainMatches(scope.value, s.blockedDomains)) {
    return { action: 'deny', reason: `${scope.value} is on the blocked list`, scope };
  }
  const policy = policyFor(tool);
  if (policy === 'deny') return { action: 'deny', reason: `${tool.label} is turned off`, scope };
  if (policy === 'auto') return { action: 'allow', reason: 'Allowed by policy', scope };
  if (scope?.kind === 'domain' && domainMatches(scope.value, s.allowedDomains)) {
    const method = String((args as { method?: string }).method ?? 'GET').toUpperCase();
    if (tool.name !== 'http_request' || method === 'GET') return { action: 'allow', reason: `${scope.value} is trusted`, scope };
  }
  return { action: 'ask', reason: 'Needs your approval', scope };
}

// ───────────────────────── Approvals ─────────────────────────

export interface ApprovalRow {
  id: string;
  run_id: string;
  conversation_id: string;
  call_id: string | null;
  agent: string;
  tool: string;
  args: string;
  summary: string;
  risk: string;
  scope: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  created_at: number;
  decided_at: number | null;
}

export function approvalJson(a: ApprovalRow) {
  return { ...a, args: parseJson(a.args, {}), scope: parseJson<ToolScope | null>(a.scope, null) };
}

const waiters = new Map<string, (approved: boolean) => void>();

export function requestApproval(input: {
  runId: string;
  conversationId: string;
  callId: string;
  agent: string;
  tool: ToolDef;
  args: Record<string, unknown>;
  summary: string;
  scope?: ToolScope;
  signal: AbortSignal;
}): Promise<boolean> {
  const aid = id('a_');
  run(
    'INSERT INTO approvals (id, run_id, conversation_id, call_id, agent, tool, args, summary, risk, scope, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    aid, input.runId, input.conversationId, input.callId, input.agent, input.tool.name, JSON.stringify(input.args), input.summary, input.tool.risk,
    input.scope ? JSON.stringify(input.scope) : null, 'pending', now(),
  );
  const row = get<ApprovalRow>('SELECT * FROM approvals WHERE id = ?', aid)!;
  emit({ type: 'approval.requested', approval: { ...approvalJson(row), toolLabel: input.tool.label } });
  void notify({ title: `Approve: ${input.summary}`, body: `${input.agent} is waiting for your OK.`, link: `/chat/${input.conversationId}`, kind: 'approval' });

  return new Promise<boolean>((resolve, reject) => {
    const onAbort = () => {
      waiters.delete(aid);
      run("UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'", now(), aid);
      emit({ type: 'approval.resolved', id: aid, status: 'expired' });
      reject(new Error('aborted'));
    };
    if (input.signal.aborted) return onAbort();
    input.signal.addEventListener('abort', onAbort, { once: true });
    waiters.set(aid, (ok) => {
      input.signal.removeEventListener('abort', onAbort);
      resolve(ok);
    });
  });
}

/** Record the user's decision. `remember` widens the policy so the same kind of call won't ask again. */
export function decideApproval(aid: string, approve: boolean, remember: boolean) {
  const row = get<ApprovalRow>('SELECT * FROM approvals WHERE id = ?', aid);
  if (!row) throw Object.assign(new Error('Approval not found'), { status: 404 });
  if (row.status !== 'pending') return approvalJson(row);
  const waiter = waiters.get(aid);
  const status = waiter ? (approve ? 'approved' : 'denied') : 'expired';
  run('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?', status, now(), aid);

  if (approve && remember) {
    const s = structuredClone(getSettings());
    const scope = parseJson<ToolScope | null>(row.scope, null);
    if (scope?.kind === 'domain') {
      if (!s.allowedDomains.includes(scope.value)) s.allowedDomains.push(scope.value);
    } else {
      s.policies[row.tool] = 'auto';
    }
    updateSettings(s);
    emit({ type: 'settings.changed' });
  }
  waiters.delete(aid);
  waiter?.(approve);
  emit({ type: 'approval.resolved', id: aid, status });
  return approvalJson({ ...row, status, decided_at: now() });
}

/** Approvals left pending by a previous server process can never be answered. */
export function expireStaleApprovals() {
  run("UPDATE approvals SET status = 'expired', decided_at = ? WHERE status = 'pending'", now());
}

export function pendingApprovals() {
  return all<ApprovalRow>("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at").map(approvalJson);
}
