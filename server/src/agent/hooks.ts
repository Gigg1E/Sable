import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { all, get, run } from '../db.js';
import { emit } from '../events.js';
import { notify, publicBase } from '../push.js';
import { errorMessage, id, now, parseJson, truncate } from '../util.js';
import { activeRunFor, createConversation, startRun, wakeChat } from './runner.js';
import { registerTool } from './tools/registry.js';

/**
 * Inbound webhooks: a secret URL that other services (GitHub, Home Assistant, IFTTT, uptime
 * monitors, your own scripts…) can call to notify you or wake the agent.
 *
 * Security: the URL carries a 256-bit token (compared in constant time); optional HMAC-SHA256
 * signatures over the raw body (GitHub's X-Hub-Signature-256 format, or a generic
 * X-Signature-256 header); duplicate deliveries are dropped by delivery id; bodies are capped at
 * 256 KB; per-hook rate limit; payloads are always treated as untrusted by the agent.
 */

export type Verify = 'none' | 'github' | 'hmac-sha256';
export interface HookAction {
  notify: boolean;
  /** Notification title template, e.g. "Deploy {{body.status}}". */
  title?: string;
  /** Instruction for the agent; the payload is attached as untrusted data. */
  prompt?: string;
  /** Wake this chat (the one that created the webhook) instead of the webhook's own chat. */
  here?: string;
}
export interface HookRow {
  id: string;
  name: string;
  token: string;
  verify: Verify;
  secret: string | null;
  action: string;
  enabled: number;
  last_received: number | null;
  count: number;
  conversation_id: string | null;
  created_at: number;
}

export function hookUrl(h: Pick<HookRow, 'id' | 'token'>) {
  return `${publicBase()}/hooks/${h.id}/${h.token}`;
}

export function hookJson(h: HookRow, reveal = false) {
  const { token, secret, ...rest } = h;
  return {
    ...rest,
    enabled: !!h.enabled,
    action: parseJson<HookAction>(h.action, { notify: true }),
    path: `/hooks/${h.id}/${token}`,
    url: hookUrl(h),
    hasSecret: !!secret,
    ...(reveal ? { secret } : {}),
  };
}

export function createHook(input: { name: string; verify: Verify; action: HookAction }) {
  const hid = id('h_');
  const token = crypto.randomBytes(32).toString('base64url');
  const secret = input.verify === 'none' ? null : crypto.randomBytes(24).toString('hex');
  run(
    'INSERT INTO hooks (id, name, token, verify, secret, action, enabled, count, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)',
    hid, input.name, token, input.verify, secret, JSON.stringify(input.action), now(),
  );
  emit({ type: 'hook.changed', id: hid });
  return get<HookRow>('SELECT * FROM hooks WHERE id = ?', hid)!;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Resolve {{body.a.b}}, {{headers.x-github-event}}, {{name}} in a template. */
function render(template: string, ctx: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path: string) => {
    let cur: any = ctx;
    for (const p of path.split('.')) cur = cur?.[p];
    return cur == null ? '' : typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  });
}

function summarizePayload(body: unknown, raw: string): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, any>;
    const pick = b.message ?? b.text ?? b.title ?? b.summary ?? b.status ?? b.action ?? b.event;
    if (typeof pick === 'string') return truncate(pick, 200);
    return truncate(JSON.stringify(body), 200);
  }
  return truncate(raw.trim(), 200) || '(empty body)';
}

const rate = new Map<string, number[]>();
function rateLimited(hid: string) {
  const t = now();
  const hits = (rate.get(hid) ?? []).filter((x) => t - x < 60_000);
  hits.push(t);
  rate.set(hid, hits);
  return hits.length > 60;
}

async function handle(req: Request, res: Response) {
  const h = get<HookRow>('SELECT * FROM hooks WHERE id = ?', String(req.params.id));
  // Same response for unknown id and wrong token: don't reveal which hooks exist.
  if (!h || !safeEqual(h.token, String(req.params.token))) return res.status(404).json({ error: 'Not found' });
  if (!h.enabled) return res.status(410).json({ error: 'This webhook is disabled' });
  if (rateLimited(h.id)) return res.status(429).json({ error: 'Too many requests' });

  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const record = (status: string, detail = '', deliveryId: string | null = null) => {
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !/authorization|cookie|signature/i.test(k)));
    run(
      'INSERT INTO hook_events (id, hook_id, ts, method, headers, body, delivery_id, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id('he_'), h.id, now(), req.method, JSON.stringify(headers), truncate(raw.toString('utf8'), 64_000), deliveryId, status, detail,
    );
    run('DELETE FROM hook_events WHERE hook_id = ? AND id NOT IN (SELECT id FROM hook_events WHERE hook_id = ? ORDER BY ts DESC LIMIT 200)', h.id, h.id);
    emit({ type: 'hook.changed', id: h.id });
  };

  // Signature check over the raw bytes, before anything is parsed or acted on.
  if (h.verify !== 'none' && h.secret) {
    const header = String(req.get(h.verify === 'github' ? 'x-hub-signature-256' : 'x-signature-256') ?? '');
    const expected = 'sha256=' + crypto.createHmac('sha256', h.secret).update(raw).digest('hex');
    if (!header || !safeEqual(header, expected)) {
      record('rejected', 'Invalid or missing signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const deliveryId = String(req.get('x-github-delivery') ?? req.get('idempotency-key') ?? req.get('x-request-id') ?? '') || null;
  if (deliveryId && get('SELECT id FROM hook_events WHERE hook_id = ? AND delivery_id = ? AND status != ?', h.id, deliveryId, 'rejected')) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const text = raw.toString('utf8');
  let body: unknown = text;
  if (/json/i.test(req.get('content-type') ?? '') || /^\s*[[{]/.test(text)) body = parseJson(text, text);
  else if (/x-www-form-urlencoded/i.test(req.get('content-type') ?? '')) body = Object.fromEntries(new URLSearchParams(text));
  if (req.method === 'GET') body = { ...req.query };

  run('UPDATE hooks SET last_received = ?, count = count + 1 WHERE id = ?', now(), h.id);
  res.status(202).json({ ok: true });

  // Act after responding so senders never time out waiting for the agent.
  const action = parseJson<HookAction>(h.action, { notify: true });
  const ctx = { name: h.name, body, headers: req.headers, method: req.method };
  let detail = '';
  try {
    if (action.notify) {
      const title = action.title ? render(action.title, ctx) : `${h.name}`;
      await notify({ title: truncate(title, 140), body: summarizePayload(body, text), link: '/webhooks', kind: 'hook', source: `hook:${h.id}` });
      detail += 'notified';
    }
    const wakeText = `[Webhook received: ${h.name}]\n${action.prompt}\n\n<untrusted source="webhook ${h.name}">\n${truncate(typeof body === 'string' ? body : JSON.stringify(body, null, 2), 20_000)}\n</untrusted>`;
    if (action.prompt && action.here && wakeChat(action.here, wakeText)) {
      detail += (detail ? ', ' : '') + 'woke its chat';
    } else if (action.prompt) {
      let cid = h.conversation_id;
      if (!cid || !get('SELECT id FROM conversations WHERE id = ?', cid) || activeRunFor(cid)) {
        cid = createConversation(`⚡ ${h.name}`, 'hook');
        run('UPDATE hooks SET conversation_id = ? WHERE id = ?', cid, h.id);
      }
      startRun(
        cid,
        `[Webhook received: ${h.name}]\n${action.prompt}\n\n<untrusted source="webhook ${h.name}">\n${truncate(typeof body === 'string' ? body : JSON.stringify(body, null, 2), 20_000)}\n</untrusted>`,
        'schedule',
      );
      detail += (detail ? ', ' : '') + 'agent started';
    }
    record('accepted', detail || 'logged', deliveryId);
  } catch (err) {
    record('error', errorMessage(err), deliveryId);
  }
}

/** Public router mounted at /hooks: no session auth, the secret URL (and signature) is the auth. */
export function hooksRouter() {
  const r = express.Router();
  r.use(express.raw({ type: () => true, limit: '256kb' }));
  r.all('/:id/:token', (req, res) => void handle(req, res).catch((err) => res.headersSent || res.status(500).json({ error: errorMessage(err) })));
  return r;
}

// ───────────────────────── Agent tools ─────────────────────────

registerTool({
  name: 'webhook_create',
  label: 'Create webhook',
  group: 'Webhooks',
  description:
    'Create an inbound webhook: a secret URL that another service can call (POST/GET) to notify the user and/or wake you with the payload. Use for "tell me when X happens" where X is a service that can send webhooks (GitHub, Home Assistant, Stripe, IFTTT, uptime monitors, scripts). Returns the URL to give that service.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      notify: { type: 'boolean', description: 'Push a notification on each call (default true)' },
      title_template: { type: 'string', description: 'Notification title; may use {{body.field}} and {{headers.name}}' },
      on_receive: { type: 'string', description: 'Optional instruction for you to carry out with each payload' },
      deliver: { type: 'string', enum: ['here', 'background'], description: "Where on_receive runs: 'here' wakes this chat with its context; 'background' (default) uses the webhook's own chat" },
      verify: { type: 'string', enum: ['none', 'github', 'hmac-sha256'], description: 'Signature verification (github = X-Hub-Signature-256). A secret is generated.' },
    },
    required: ['name'],
  },
  risk: 'high',
  defaultPolicy: 'ask',
  summarize: (a) => `Create webhook “${a.name}”${a.on_receive ? ' that wakes the agent' : ''}`,
  async run(a, ctx) {
    const h = createHook({
      name: String(a.name),
      verify: (a.verify as Verify) ?? 'none',
      action: { notify: a.notify !== false, title: a.title_template || undefined, prompt: a.on_receive || undefined, here: a.deliver === 'here' ? ctx.conversationId : undefined },
    });
    const url = hookUrl(h);
    return `Webhook ${h.id} created.\nURL: ${url.startsWith('/') ? `<your Sable address>${url}` : url}${h.secret ? `\nSigning secret (configure it in the sending service): ${h.secret}` : ''}\nThe user can copy it any time from Webhooks.`;
  },
});

registerTool({
  name: 'webhook_list',
  label: 'List webhooks',
  group: 'Webhooks',
  description: 'List inbound webhooks and when they last fired.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const rows = all<HookRow>('SELECT * FROM hooks ORDER BY created_at DESC');
    if (!rows.length) return 'No webhooks.';
    return rows.map((h) => `${h.id} — ${h.name} [${h.enabled ? 'on' : 'off'}] calls: ${h.count}, last: ${h.last_received ? new Date(h.last_received).toISOString() : 'never'}`).join('\n');
  },
});

registerTool({
  name: 'webhook_delete',
  label: 'Delete webhook',
  group: 'Webhooks',
  description: 'Delete an inbound webhook by id (its URL stops working).',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Delete webhook ${a.id}`,
  async run(a) {
    const r = run('DELETE FROM hooks WHERE id = ?', String(a.id));
    emit({ type: 'hook.changed', id: a.id, deleted: true });
    return r.changes ? 'Webhook deleted.' : 'No webhook with that id.';
  },
});
