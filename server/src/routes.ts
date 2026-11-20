import express, { type NextFunction, type Request, type Response } from 'express';
import { activeRunFor, activeRuns, cancelRun, createConversation, HttpError, interject, messageJson, quickAnswer, reflex, startRun, type MessageRow } from './agent/runner.js';
import { decideApproval, denyAllApprovals, pendingApprovals, policyFor } from './agent/sentinel.js';
import { beginOAuth, completeOAuth, mcpStatus, reloadMcp } from './agent/tools/mcp.js';
import { clearState, forgetOAuth, oauthCallbackUrl, serverForState } from './agent/tools/mcpAuth.js';
import { computeNextRun, goalJson, type GoalRow, type ScheduleKind, type ScheduleSpec } from './agent/tools/personal.js';
import { getTool, listTools } from './agent/tools/registry.js';
import { syncCalendarTools, testFeed } from './agent/tools/calendar.js';
import { syncEmailTools } from './agent/tools/email.js';
import { backfillMemoryEmbeddings, setSpaceData } from './agent/tools/personal.js';
import { ensureHelpers, helperStatus } from './agent/helpers.js';
import { PROVIDERS, testAccount } from './email.js';
import { listConnections, removeConnection, setSecret } from './connections.js';
import { beginGoogleLink, completeGoogleLink, googleAccounts, isGoogleState, unlinkGoogle } from './google.js';
import { cancelJob, continueJob, getJob, listJobs } from './agent/subagents.js';
import { isFrozen, setFrozen, verifyActivity } from './safety.js';
import { deletePerson, listPeople, savePerson } from './people.js';
import { isMain, journalAdd, journalClose, journalDelete, journalRecent, mainConversationId, openLoops } from './brain.js';
import { addItem, forgetItem, getItem, libraryStats, libSnippet, listItems, search, setPrivacy } from './library.js';
import { createReminder, deleteReminder, listReminders, parseDue, updateReminder } from './reminders.js';
import {
  beginTwoFactor, checkPassword, checkSecondFactor, confirmTwoFactor, createSession, destroyAllSessions, destroySession, disableTwoFactor, isAuthed, isSetUp, loginAllowed,
  recordFailedLogin, recoveryCodesLeft, requireAuth, sessionCount, setPassword, twoFactorEnabled,
} from './auth.js';
import QRCode from 'qrcode';
import { spaceFrameHtml } from './spaceframe.js';
import { all, get, run } from './db.js';
import { emit, sseHandler } from './events.js';
import { providerFor } from './llm/index.js';
import { pullOllamaModel } from './llm/pull.js';
import { checkExitIp, proxyLabel } from './net.js';
import { checkWatcher, createWatcher, describeCondition, extractFrom, parseNumber, watcherJson, type Condition, type ExtractSpec, type WatcherRow } from './agent/watchers.js';
import { createHook, hookJson, type HookAction, type HookRow, type Verify } from './agent/hooks.js';
import crypto from 'node:crypto';
import { kvSet } from './db.js';
import { notify, removeSubscription, saveSubscription, sendToChannel, vapidPublicKey } from './push.js';
import { fireSchedule } from './scheduler.js';
import { getSettings, publicSettings, updateSettings, type CalendarFeed, type EmailAccount, type ProviderConfig, type Settings } from './settings.js';
import { errorMessage, id, now, parseJson } from './util.js';
import { getUpload, uploadRoutes } from './uploads.js';
import { workspaceRoutes } from './agent/tools/workspace.js';
import { beginAppLink, beginDeviceLink, completeAppLink, shopLinkStatus, unlinkShop } from './shop/auth.js';
import { shopCall, shopErrorText } from './shop/client.js';

type Handler = (req: Request, res: Response) => unknown;
/** Wrap async handlers so thrown errors become JSON responses. */
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    next(err);
  }
};
const param = (req: Request, name: string) => String(req.params[name]);

/**
 * Cross-site request guard. Browsers label every request with Sec-Fetch-Site / Origin; anything that
 * changes state must come from Sable's own page. "same-site" is rejected too: that's a sibling
 * subdomain (e.g. your main website), not Sable itself.
 */
function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Cross-site request blocked' });
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      /* invalid */
    }
    const allowed = new Set([req.get('host'), req.get('x-forwarded-host')].filter(Boolean));
    if (!allowed.has(host)) return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  next();
}

/** The address the user's browser reached this app at (honours X-Forwarded-* from a trusted proxy such as Tailscale). */
function appOrigin(req: Request) {
  // The browser's own origin is exact (proxies such as Tailscale serve or Docker can change Host or the scheme).
  for (const v of [req.get('origin'), typeof req.query.origin === 'string' ? req.query.origin : undefined]) {
    if (!v) continue;
    try {
      const u = new URL(v);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v.replace(/\/+$/, '')) return u.origin;
    } catch {
      /* ignore malformed */
    }
  }
  return `${req.protocol}://${req.host}`;
}

export function apiRouter() {
  const r = express.Router();
  r.use(sameOriginOnly);
  r.use(express.json({ limit: '4mb' }));

  // ── Auth (public) ──
  r.get('/auth/status', h((req) => ({ setup: isSetUp(), authed: isAuthed(req), twoFactor: twoFactorEnabled() })));
  r.post(
    '/auth/setup',
    h((req, res) => {
      if (isSetUp()) throw new HttpError(400, 'Already set up');
      const pw = String(req.body?.password ?? '');
      if (pw.length < 8) throw new HttpError(400, 'Use at least 8 characters.');
      setPassword(pw);
      createSession(req, res);
      return { ok: true };
    }),
  );
  r.post(
    '/auth/login',
    h((req, res) => {
      const ip = req.ip ?? 'unknown';
      if (!loginAllowed(ip)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
      if (!checkPassword(String(req.body?.password ?? ''))) {
        recordFailedLogin(ip);
        throw new HttpError(401, 'Wrong password.');
      }
      if (twoFactorEnabled()) {
        const code = String(req.body?.code ?? '');
        if (!code) return res.status(401).json({ error: 'Enter the code from your authenticator app.', needCode: true });
        if (!checkSecondFactor(code)) {
          recordFailedLogin(ip);
          return res.status(401).json({ error: 'That code is not valid.', needCode: true });
        }
      }
      createSession(req, res);
      return { ok: true };
    }),
  );
  r.post('/auth/logout', h((req, res) => destroySession(req, res)));

  r.use(requireAuth);

  r.post(
    '/auth/password',
    h((req, res) => {
      if (!checkPassword(String(req.body?.current ?? ''))) throw new HttpError(401, 'Current password is wrong.');
      const next = String(req.body?.next ?? '');
      if (next.length < 8) throw new HttpError(400, 'Use at least 8 characters.');
      setPassword(next);
      destroyAllSessions();
      createSession(req, res);
      return { ok: true };
    }),
  );

  r.get('/events', sseHandler);

  // ── Security ──
  r.get('/security', h(() => ({ twoFactor: twoFactorEnabled(), recoveryLeft: recoveryCodesLeft(), sessions: sessionCount() })));
  r.post(
    '/security/2fa/begin',
    h(async (req) => {
      if (!checkPassword(String(req.body?.password ?? ''))) throw new HttpError(401, 'Password is wrong.');
      const { secret, uri } = beginTwoFactor(getSettings().persona.name || 'Sable');
      return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
    }),
  );
  r.post(
    '/security/2fa/confirm',
    h((req) => {
      const codes = confirmTwoFactor(String(req.body?.code ?? ''));
      if (!codes) throw new HttpError(400, 'That code didn\'t match. Check your phone\'s clock and try the newest code.');
      return { recoveryCodes: codes };
    }),
  );
  r.post(
    '/security/2fa/disable',
    h((req) => {
      if (!checkPassword(String(req.body?.password ?? ''))) throw new HttpError(401, 'Password is wrong.');
      if (!checkSecondFactor(String(req.body?.code ?? ''))) throw new HttpError(401, 'That code is not valid.');
      disableTwoFactor();
      return { ok: true };
    }),
  );
  r.post(
    '/security/signout-all',
    h((req, res) => {
      destroyAllSessions();
      createSession(req, res); // keep this device signed in
      return { ok: true };
    }),
  );
  uploadRoutes(r);
  workspaceRoutes(r);

  r.get(
    '/bootstrap',
    h((req) => {
      // Remember how the user reaches this server, to build webhook and notification links.
      const origin = appOrigin(req);
      if (req.get('host') && !/^(localhost|127\.|\[::1\])/.test(req.get('host')!)) kvSet('lastOrigin', origin);
      kvSet('appOrigin', origin);
      return {
      settings: publicSettings(),
      approvals: pendingApprovals(),
      activeRuns: activeRuns(),
      unread: get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE read = 0')?.n ?? 0,
      };
    }),
  );

  // ── Watchers ──
  const watcherOut = (w: WatcherRow) => ({
    ...watcherJson(w),
    conditionLabel: describeCondition(watcherJson(w).condition),
    spark: all('SELECT ts, numeric, triggered FROM (SELECT ts, numeric, triggered FROM watch_history WHERE watcher_id = ? AND numeric IS NOT NULL ORDER BY ts DESC LIMIT 40) ORDER BY ts', w.id),
  });
  r.get('/watchers', h(() => all<WatcherRow>('SELECT * FROM watchers ORDER BY created_at DESC').map(watcherOut)));
  r.get(
    '/watchers/:id/history',
    h((req) => all('SELECT ts, value, numeric, triggered FROM watch_history WHERE watcher_id = ? ORDER BY ts DESC LIMIT 200', param(req, 'id'))),
  );
  const normCondition = (c: Condition & { value?: unknown }): Condition => {
    if (['below', 'above', 'drop_percent', 'rise_percent'].includes(c.kind)) return { kind: c.kind, value: parseNumber(c.value) ?? 0 } as Condition;
    return c;
  };
  r.post(
    '/watchers/test',
    h(async (req) => {
      try {
        return { ok: true, ...(await extractFrom(String(req.body?.url), req.body?.extract as ExtractSpec)) };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }),
  );
  r.post(
    '/watchers',
    h((req) => {
      const b = req.body ?? {};
      if (!/^https?:\/\//.test(String(b.url))) throw new HttpError(400, 'Enter an http(s) URL');
      return { id: createWatcher({ title: String(b.title || new URL(b.url).host), url: String(b.url), extract: b.extract, condition: normCondition(b.condition ?? { kind: 'changed' }), interval_min: Number(b.interval_min) || 60, actions: b.actions ?? { notify: true } }) };
    }),
  );
  r.patch(
    '/watchers/:id',
    h((req) => {
      const w = get<WatcherRow>('SELECT * FROM watchers WHERE id = ?', param(req, 'id'));
      if (!w) throw new HttpError(404, 'Not found');
      const b = req.body ?? {};
      run(
        'UPDATE watchers SET title = ?, enabled = ?, interval_min = ?, condition = ?, actions = ?, next_check = CASE WHEN ? THEN ? ELSE next_check END WHERE id = ?',
        String(b.title ?? w.title), b.enabled === undefined ? w.enabled : b.enabled ? 1 : 0, Math.max(5, Number(b.interval_min ?? w.interval_min)),
        b.condition ? JSON.stringify(normCondition(b.condition)) : w.condition, b.actions ? JSON.stringify(b.actions) : w.actions,
        b.enabled ? 1 : 0, now(), w.id,
      );
      emit({ type: 'watcher.changed', id: w.id });
    }),
  );
  r.post('/watchers/:id/check', h(async (req) => checkWatcher(param(req, 'id'))));
  r.delete(
    '/watchers/:id',
    h((req) => {
      run('DELETE FROM watchers WHERE id = ?', param(req, 'id'));
      emit({ type: 'watcher.changed', id: param(req, 'id'), deleted: true });
    }),
  );

  // ── Inbound webhooks ──
  r.get('/hooks', h(() => all<HookRow>('SELECT * FROM hooks ORDER BY created_at DESC').map((x) => hookJson(x))));
  r.post(
    '/hooks',
    h((req) => {
      const b = req.body ?? {};
      const hook = createHook({ name: String(b.name || 'Webhook'), verify: (b.verify as Verify) ?? 'none', action: (b.action as HookAction) ?? { notify: true } });
      return hookJson(hook, true);
    }),
  );
  r.get('/hooks/:id/secret', h((req) => ({ secret: get<HookRow>('SELECT * FROM hooks WHERE id = ?', param(req, 'id'))?.secret ?? null })));
  r.get('/hooks/:id/events', h((req) => all('SELECT * FROM hook_events WHERE hook_id = ? ORDER BY ts DESC LIMIT 50', param(req, 'id'))));
  r.patch(
    '/hooks/:id',
    h((req) => {
      const x = get<HookRow>('SELECT * FROM hooks WHERE id = ?', param(req, 'id'));
      if (!x) throw new HttpError(404, 'Not found');
      const b = req.body ?? {};
      run('UPDATE hooks SET name = ?, enabled = ?, action = ? WHERE id = ?', String(b.name ?? x.name), b.enabled === undefined ? x.enabled : b.enabled ? 1 : 0, b.action ? JSON.stringify(b.action) : x.action, x.id);
      emit({ type: 'hook.changed', id: x.id });
    }),
  );
  r.post(
    '/hooks/:id/rotate',
    h((req) => {
      run('UPDATE hooks SET token = ? WHERE id = ?', crypto.randomBytes(32).toString('base64url'), param(req, 'id'));
      emit({ type: 'hook.changed', id: param(req, 'id') });
      return hookJson(get<HookRow>('SELECT * FROM hooks WHERE id = ?', param(req, 'id'))!);
    }),
  );
  r.delete(
    '/hooks/:id',
    h((req) => {
      run('DELETE FROM hooks WHERE id = ?', param(req, 'id'));
      emit({ type: 'hook.changed', id: param(req, 'id'), deleted: true });
    }),
  );

  // ── Notification channels ──
  r.post(
    '/channels/test',
    h(async (req) => {
      const c = req.body ?? {};
      const saved = getSettings().channels.find((x) => x.id === c.id);
      const ch = { ...c, url: String(c.url ?? '').includes('••') ? (saved?.url ?? '') : c.url, token: String(c.token ?? '').includes('••') ? saved?.token : c.token };
      try {
        await sendToChannel(ch, `${getSettings().persona.name} test notification`, 'If you can read this, the channel works.', '');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }),
  );

  // ── Conversations ──
  r.get(
    '/conversations',
    h(() =>
      all(
        `SELECT c.*, (SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.role IN ('user','assistant') AND m.content != '' ORDER BY m.rowid DESC LIMIT 1) AS preview
         FROM conversations c ORDER BY c.updated_at DESC LIMIT 300`,
      ).map((c: any) => ({ ...c, pinned: !!c.pinned, running: !!activeRunFor(c.id) })),
    ),
  );
  r.post('/conversations', h(() => ({ id: createConversation() })));
  r.get(
    '/conversations/:id',
    h((req) => {
      const cid = param(req, 'id');
      const conv = get('SELECT * FROM conversations WHERE id = ?', cid);
      if (!conv) throw new HttpError(404, 'Not found');
      const messages = all<MessageRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid', cid)
        .map(messageJson)
        .map((m) => ({
          ...m,
          tool_calls: m.tool_calls?.map((tc) => {
            const tool = getTool(tc.name);
            let summary = tool?.label ?? tc.name;
            try {
              summary = tool?.summarize?.(tc.args) ?? summary;
            } catch {
              /* keep label */
            }
            return { ...tc, summary, label: tool?.label ?? tc.name };
          }) ?? null,
        }));
      const activity = all<{ run_id: string; tool: string; status: string; summary: string }>(
        'SELECT run_id, tool, status, summary FROM activity WHERE conversation_id = ? ORDER BY ts', cid,
      );
      return { conversation: conv, messages, activeRun: activeRunFor(cid)?.runId ?? null, approvals: pendingApprovals().filter((a) => a.conversation_id === cid), activity };
    }),
  );
  r.patch(
    '/conversations/:id',
    h((req) => {
      if (req.body?.title !== undefined) run('UPDATE conversations SET title = ? WHERE id = ?', String(req.body.title || 'Untitled').slice(0, 120), param(req, 'id'));
      if (req.body?.pinned !== undefined) run('UPDATE conversations SET pinned = ? WHERE id = ?', req.body.pinned ? 1 : 0, param(req, 'id'));
      emit({ type: 'conversation.changed', id: param(req, 'id') });
    }),
  );
  r.delete(
    '/conversations/:id',
    h((req) => {
      const cid = param(req, 'id');
      if (isMain(cid)) throw new HttpError(400, "Main is permanent, so it can't be deleted.");
      const act = activeRunFor(cid);
      if (act) cancelRun(act.runId);
      run('DELETE FROM conversations WHERE id = ?', cid);
      emit({ type: 'conversation.changed', id: cid, deleted: true });
    }),
  );
  r.post(
    '/conversations/:id/messages',
    h((req) => {
      const text = String(req.body?.text ?? '').trim();
      const attachments = (Array.isArray(req.body?.attachments) ? req.body.attachments : []).map(String).slice(0, 8);
      for (const a of attachments) if (!getUpload(a)) throw new HttpError(400, 'An attached file is missing. Try attaching it again.');
      if (!text && !attachments.length) throw new HttpError(400, 'Message is empty');
      if (!attachments.length && reflex(param(req, 'id'), text)) return { runId: null, reflex: true };
      return { runId: startRun(param(req, 'id'), text, 'user', attachments) };
    }),
  );
  r.post(
    '/conversations/:id/interject',
    h((req) => {
      const text = String(req.body?.text ?? '').trim();
      if (!text) throw new HttpError(400, 'Message is empty');
      return interject(param(req, 'id'), text.slice(0, 20_000));
    }),
  );
  r.post('/runs/:id/cancel', h((req) => cancelRun(param(req, 'id'))));

  // ── Safety: freeze and the activity log's integrity ──
  r.get('/safety', h(() => ({ frozen: isFrozen() })));
  r.post(
    '/safety/freeze',
    h((req) => {
      const on = req.body?.frozen !== false;
      setFrozen(on, 'app');
      return { frozen: on, denied: on ? denyAllApprovals() : 0 };
    }),
  );
  r.get('/activity/verify', h(() => verifyActivity()));

  // ── Approvals ──
  r.get('/approvals', h(() => pendingApprovals()));
  r.post(
    '/approvals/:id/decision',
    h((req) => decideApproval(param(req, 'id'), req.body?.decision === 'approve', !!req.body?.remember, req.body?.choice ? String(req.body.choice) : undefined)),
  );

  // ── Activity log ──
  r.get(
    '/activity',
    h((req) => {
      const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      return all('SELECT * FROM activity WHERE ts < ? ORDER BY ts DESC LIMIT ?', before, limit);
    }),
  );

  // ── Memory ──
  r.get('/memories', h(() => all('SELECT id, content, source, kind, created_at, updated_at FROM memories ORDER BY updated_at DESC')));
  r.get('/helpers', h(() => helperStatus()));
  r.post('/helpers/install', h(() => ensureHelpers(true)));
  r.post(
    '/memories',
    h((req) => {
      const mid = id('m_');
      run('INSERT INTO memories (id, content, source, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', mid, String(req.body?.content ?? '').trim(), 'you', ['other', 'howto'].includes(req.body?.kind) ? req.body.kind : 'me', now(), now());
      void backfillMemoryEmbeddings();
      emit({ type: 'memory.changed' });
      return { id: mid };
    }),
  );
  r.patch(
    '/memories/:id',
    h((req) => {
      if (req.body?.content !== undefined) run('UPDATE memories SET content = ?, embedding = NULL, updated_at = ? WHERE id = ?', String(req.body.content), now(), param(req, 'id'));
      void backfillMemoryEmbeddings();
      if (['me', 'other', 'howto'].includes(req.body?.kind)) run('UPDATE memories SET kind = ? WHERE id = ?', req.body.kind, param(req, 'id'));
      emit({ type: 'memory.changed' });
    }),
  );
  r.delete(
    '/memories/:id',
    h((req) => {
      run('DELETE FROM memories WHERE id = ?', param(req, 'id'));
      emit({ type: 'memory.changed' });
    }),
  );

  // ── Goals ──
  r.get('/goals', h(() => all<GoalRow>('SELECT * FROM goals ORDER BY updated_at DESC').map(goalJson)));
  r.patch(
    '/goals/:id',
    h((req) => {
      const g = get<GoalRow>('SELECT * FROM goals WHERE id = ?', param(req, 'id'));
      if (!g) throw new HttpError(404, 'Not found');
      const steps = req.body?.steps ? JSON.stringify(req.body.steps) : g.steps;
      run('UPDATE goals SET status = ?, steps = ?, updated_at = ? WHERE id = ?', String(req.body?.status ?? g.status), steps, now(), g.id);
      const updated = goalJson(get<GoalRow>('SELECT * FROM goals WHERE id = ?', g.id)!);
      emit({ type: 'goal.changed', goal: updated });
      return updated;
    }),
  );
  r.delete(
    '/goals/:id',
    h((req) => {
      run('DELETE FROM goals WHERE id = ?', param(req, 'id'));
      emit({ type: 'goal.changed', id: param(req, 'id'), deleted: true });
    }),
  );

  // ── Spaces ──
  const spaceJson = (s: any) => ({ ...s, data: parseJson(s.data, {}), pinned: !!s.pinned });
  r.get('/spaces', h(() => all('SELECT id, title, description, icon, pinned, created_at, updated_at FROM spaces ORDER BY pinned DESC, updated_at DESC').map((s: any) => ({ ...s, pinned: !!s.pinned }))));
  r.get(
    '/spaces/:id',
    h((req) => {
      const s = get('SELECT * FROM spaces WHERE id = ?', param(req, 'id'));
      if (!s) throw new HttpError(404, 'Not found');
      return spaceJson(s);
    }),
  );
  r.patch(
    '/spaces/:id',
    h((req) => {
      const b = req.body ?? {};
      run(
        'UPDATE spaces SET title = COALESCE(?, title), pinned = COALESCE(?, pinned), updated_at = ? WHERE id = ?',
        b.title ?? null, b.pinned === undefined ? null : b.pinned ? 1 : 0, now(), param(req, 'id'),
      );
      emit({ type: 'space.changed', id: param(req, 'id') });
    }),
  );
  r.delete(
    '/spaces/:id',
    h((req) => {
      run('DELETE FROM spaces WHERE id = ?', param(req, 'id'));
      emit({ type: 'space.changed', id: param(req, 'id'), deleted: true });
    }),
  );
  // Spaces render from their own URL with a sandbox CSP: their scripts get an opaque origin and no
  // network, so a space can never act as you, even if its HTML was influenced by a web page.
  r.get('/spaces/:id/frame', (req, res) => {
    const s = get<{ html: string; theme: string | null }>('SELECT html, theme FROM spaces WHERE id = ?', param(req, 'id'));
    if (!s) return res.status(404).type('text').send('Not found');
    res.setHeader('Content-Security-Policy', [
      "default-src 'none'",
      "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com data:",
      "img-src data: blob: https:",
      "media-src data: blob:",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
      'sandbox allow-scripts allow-forms allow-modals allow-popups',
    ].join('; '));
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(spaceFrameHtml(s.html, req.query.theme === 'light' ? 'light' : 'dark', parseJson(s.theme, {})));
  });
  r.put(
    '/spaces/:id/data',
    h((req) => {
      const s = get<{ data: string }>('SELECT data FROM spaces WHERE id = ?', param(req, 'id'));
      if (!s) throw new HttpError(404, 'Not found');
      try {
        setSpaceData(param(req, 'id'), String(req.body?.key), req.body?.value);
      } catch (err) {
        throw new HttpError(413, errorMessage(err));
      }
      return { ok: true };
    }),
  );
  r.post(
    '/spaces/:id/ask',
    h(async (req) => {
      const s = get<{ title: string; data: string }>('SELECT title, data FROM spaces WHERE id = ?', param(req, 'id'));
      if (!s) throw new HttpError(404, 'Not found');
      const system = `You are ${getSettings().persona.name}, answering a request made from inside the user's "${s.title}" Space (a mini-app). Reply with only what was asked for, no preamble. If JSON is requested, reply with JSON only.\n\nSpace data:\n${s.data.slice(0, 20_000)}`;
      return { text: await quickAnswer(system, String(req.body?.prompt ?? '')) };
    }),
  );

  // A space button starting a real task: runs in the space's own chat with the agent's tools.
  r.post(
    '/spaces/:id/act',
    h((req) => {
      const s = get<{ id: string; title: string; conversation_id: string | null }>('SELECT id, title, conversation_id FROM spaces WHERE id = ?', param(req, 'id'));
      if (!s) throw new HttpError(404, 'Not found');
      let cid = s.conversation_id;
      if (!cid || !get('SELECT id FROM conversations WHERE id = ?', cid)) {
        cid = createConversation(s.title, 'chat');
        run('UPDATE spaces SET conversation_id = ? WHERE id = ?', cid, s.id);
      }
      const prompt = String(req.body?.prompt ?? '').slice(0, 4000);
      if (!prompt) throw new HttpError(400, 'Empty request');
      const msg = `[From the "${s.title}" space (${s.id})] ${prompt}\n(Update the space's data with space_data_set as you go; it updates live.)`;
      const busy = activeRunFor(cid);
      if (busy) return { ...interject(cid, msg), conversationId: cid };
      return { runId: startRun(cid, msg), conversationId: cid };
    }),
  );

  // ── Schedules ──
  const scheduleJson = (s: any) => ({ ...s, spec: parseJson(s.spec, {}), enabled: !!s.enabled, notify: s.notify ?? (s.kind === 'interval' ? 'when_new' : 'always'), autonomy: s.autonomy ?? 'ask', restrict: parseJson(s.restrict_tools, []) });
  r.get('/schedules', h(() => all("SELECT * FROM schedules WHERE NOT (kind = 'once' AND enabled = 0 AND last_run IS NOT NULL) ORDER BY created_at DESC").map(scheduleJson)));
  r.post(
    '/schedules',
    h((req) => {
      const b = req.body ?? {};
      const spec: ScheduleSpec = { at: b.at, every_minutes: b.every_minutes, time: b.time, weekday: b.weekday };
      const next = computeNextRun(b.kind as ScheduleKind, spec);
      if (next == null) throw new HttpError(400, 'That time is in the past or invalid.');
      const sid = id('sch_');
      run(
        'INSERT INTO schedules (id, title, prompt, kind, spec, next_run, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        sid, String(b.title ?? 'Task'), String(b.prompt ?? ''), String(b.kind), JSON.stringify(spec), next, now(),
      );
      emit({ type: 'schedule.changed' });
      return { id: sid };
    }),
  );
  r.patch(
    '/schedules/:id',
    h((req) => {
      const s = get<any>('SELECT * FROM schedules WHERE id = ?', param(req, 'id'));
      if (!s) throw new HttpError(404, 'Not found');
      const enabled = req.body?.enabled === undefined ? !!s.enabled : !!req.body.enabled;
      const next = enabled ? computeNextRun(s.kind, parseJson(s.spec, {})) : s.next_run;
      const notify = req.body?.notify === 'always' || req.body?.notify === 'when_new' ? req.body.notify : null;
      const autonomy = req.body?.autonomy === 'auto' || req.body?.autonomy === 'ask' ? req.body.autonomy : null;
      run('UPDATE schedules SET enabled = ?, next_run = ?, notify = COALESCE(?, notify), autonomy = COALESCE(?, autonomy) WHERE id = ?', enabled && next != null ? 1 : 0, next, notify, autonomy, s.id);
      emit({ type: 'schedule.changed' });
    }),
  );
  r.delete(
    '/schedules/:id',
    h((req) => {
      run('DELETE FROM schedules WHERE id = ?', param(req, 'id'));
      emit({ type: 'schedule.changed' });
    }),
  );
  r.post('/schedules/:id/run', h((req) => ({ runId: fireSchedule(param(req, 'id')) ?? null })));

  // ── Sub-agent jobs ──
  r.get('/jobs', h((req) => listJobs(req.query.conversationId ? String(req.query.conversationId) : undefined)));
  r.get(
    '/jobs/:id',
    h((req) => {
      const j = getJob(param(req, 'id'));
      if (!j) throw new HttpError(404, 'Not found');
      return j;
    }),
  );
  r.post('/jobs/:id/cancel', h((req) => ({ cancelled: cancelJob(param(req, 'id')) })));
  r.post(
    '/jobs/:id/continue',
    h((req) => {
      try {
        return continueJob(param(req, 'id'), req.body?.note ? String(req.body.note) : undefined);
      } catch (err) {
        throw new HttpError(400, errorMessage(err));
      }
    }),
  );

  // ── Library ──
  r.get(
    '/library',
    h((req) => ({
      items: listItems({ kind: req.query.kind ? String(req.query.kind) : undefined, privacy: req.query.privacy ? String(req.query.privacy) : undefined, q: req.query.q ? String(req.query.q) : undefined, before: Number(req.query.before) || undefined }),
      stats: libraryStats(),
    })),
  );
  r.get(
    '/library/search',
    h(async (req) => (await search(String(req.query.q ?? ''), { limit: 30 })).map((h) => ({ ...h.item, body: undefined, snippet: libSnippet(h.chunk, 300), score: h.score }))),
  );
  r.get(
    '/library/:id',
    h((req) => {
      const it = getItem(param(req, 'id'));
      if (!it) throw new HttpError(404, 'That item is gone.');
      return it;
    }),
  );
  r.post(
    '/library',
    h((req) => {
      const title = String(req.body?.title ?? '').trim();
      const body = String(req.body?.body ?? '').trim();
      if (!body) throw new HttpError(400, 'Write something to save.');
      return addItem({ kind: 'note', title: title || body.split('\n')[0].slice(0, 80), body, source: 'you', trust: 'owner', privacy: req.body?.privacy === 'open' || req.body?.privacy === 'private' ? req.body.privacy : undefined });
    }),
  );
  r.patch(
    '/library/:id',
    h((req) => {
      if (req.body?.privacy !== 'open' && req.body?.privacy !== 'private') throw new HttpError(400, 'privacy must be open or private');
      setPrivacy(param(req, 'id'), req.body.privacy);
      return getItem(param(req, 'id'));
    }),
  );
  r.delete('/library/:id', h((req) => ({ forgotten: forgetItem(param(req, 'id')) })));

  // ── Main chat and journal ──
  r.get('/main', h(() => ({ id: mainConversationId() })));
  r.get('/journal', h((req) => ({ open: openLoops(), recent: journalRecent(Math.min(Number(req.query.days) || 14, 90)) })));
  r.post(
    '/journal',
    h((req) => {
      const text = String(req.body?.text ?? '').trim();
      if (!text) throw new HttpError(400, 'Write something.');
      return journalAdd(req.body?.kind === 'open_loop' ? 'open_loop' : 'note', text, mainConversationId());
    }),
  );
  r.patch('/journal/:id', h((req) => ({ ok: journalClose(param(req, 'id'), req.body?.done !== false) })));
  r.delete('/journal/:id', h((req) => ({ ok: journalDelete(param(req, 'id')) })));

  // ── People ──
  r.get('/people', h(() => listPeople()));
  r.post(
    '/people',
    h((req) => {
      const b = req.body ?? {};
      if (!String(b.name ?? '').trim()) throw new HttpError(400, 'A name is needed.');
      return savePerson({ id: b.id ? String(b.id) : undefined, name: String(b.name).trim(), kind: b.kind === 'pet' ? 'pet' : 'person', relation: b.relation ?? undefined, aliases: Array.isArray(b.aliases) ? b.aliases.map(String) : undefined, contacts: Array.isArray(b.contacts) ? b.contacts : undefined, preferred: b.preferred ?? undefined, notes: b.notes ?? undefined });
    }),
  );
  r.put(
    '/people/:id',
    h((req) => {
      // A full edit from the People page: replace lists instead of merging.
      const b = req.body ?? {};
      run('UPDATE people SET name = ?, kind = ?, relation = ?, aliases = ?, contacts = ?, preferred = ?, notes = ?, updated_at = ? WHERE id = ?',
        String(b.name ?? '').trim() || 'Someone', b.kind === 'pet' ? 'pet' : 'person', b.relation || null, JSON.stringify(Array.isArray(b.aliases) ? b.aliases : []), JSON.stringify(Array.isArray(b.contacts) ? b.contacts : []), b.preferred || null, b.notes || null, now(), param(req, 'id'));
      emit({ type: 'people.changed' });
      return listPeople().find((p) => p.id === param(req, 'id'));
    }),
  );
  r.delete('/people/:id', h((req) => ({ deleted: deletePerson(param(req, 'id')) })));

  // ── Reminders (one-off) ──
  r.get('/reminders', h(() => listReminders()));
  r.post(
    '/reminders',
    h((req) => {
      const due = parseDue(req.body?.at, req.body?.in_minutes);
      if (typeof due === 'string') throw new HttpError(400, due);
      if (!String(req.body?.text ?? '').trim()) throw new HttpError(400, 'What should the reminder say?');
      return createReminder({ text: String(req.body.text), note: req.body?.note ? String(req.body.note) : undefined, due });
    }),
  );
  r.patch(
    '/reminders/:id',
    h((req) => {
      let due: number | undefined;
      if (req.body?.at || req.body?.in_minutes != null) {
        const d = parseDue(req.body.at, req.body.in_minutes);
        if (typeof d === 'string') throw new HttpError(400, d);
        due = d;
      }
      const r = updateReminder(param(req, 'id'), { text: req.body?.text, note: req.body?.note, due });
      if (!r) throw new HttpError(404, 'That reminder already went off or was cancelled.');
      return r;
    }),
  );
  r.delete('/reminders/:id', h((req) => void deleteReminder(param(req, 'id'))));

  // ── Notifications ──
  r.get('/notifications', h(() => all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100')));
  r.post(
    '/notifications/read',
    h(() => {
      run('UPDATE notifications SET read = 1 WHERE read = 0');
      emit({ type: 'notifications.read' });
    }),
  );
  r.delete('/notifications', h(() => run('DELETE FROM notifications') && undefined));

  // ── Settings, models, tools, connectors ──
  r.get('/settings', h(() => publicSettings()));
  r.put(
    '/settings',
    h(async (req) => {
      const before = JSON.stringify(getSettings().mcpServers);
      updateSettings(req.body as Settings);
      if (JSON.stringify(getSettings().mcpServers) !== before) void reloadMcp();
      syncCalendarTools();
      syncEmailTools();
      emit({ type: 'settings.changed' });
      return publicSettings();
    }),
  );
  r.post(
    '/providers/models',
    h(async (req) => {
      // Accepts either a saved provider id or an unsaved config (for "test connection").
      const body = req.body as { id?: string; config?: ProviderConfig };
      let cfg = body.config ?? getSettings().providers.find((p) => p.id === body.id);
      if (!cfg) throw new HttpError(404, 'Unknown provider');
      if (body.config?.apiKey?.startsWith('••')) cfg = { ...body.config, apiKey: getSettings().providers.find((p) => p.id === body.config!.id)?.apiKey };
      try {
        return { ok: true, models: await providerFor(cfg).listModels() };
      } catch (err) {
        return { ok: false, error: errorMessage(err), models: [] };
      }
    }),
  );
  r.post(
    '/providers/:id/pull',
    h((req) => {
      const cfg = getSettings().providers.find((p) => p.id === param(req, 'id'));
      if (!cfg) throw new HttpError(404, 'Unknown provider');
      if (cfg.type !== 'ollama') throw new HttpError(400, 'Only Ollama can download models.');
      const model = String(req.body?.model ?? '').trim();
      if (!/^[\w.\-/:]+$/.test(model)) throw new HttpError(400, 'Invalid model name');
      pullOllamaModel(cfg, model);
      return { ok: true };
    }),
  );
  r.get(
    '/tools',
    h(() =>
      listTools().map((t) => ({ name: t.name, label: t.label, group: t.group, description: t.description, risk: t.risk, source: t.source, defaultPolicy: t.defaultPolicy, policy: policyFor(t) })),
    ),
  );
  r.get('/network', h(() => ({ proxy: proxyLabel() })));
  r.post(
    '/network/check',
    h(async () => {
      try {
        return { ok: true, ...(await checkExitIp()) };
      } catch (err) {
        return { ok: false, error: errorMessage(err), proxy: proxyLabel() };
      }
    }),
  );
  // ── Shopping (Shop) ──
  r.get(
    '/shop/status',
    h(async () => {
      const link = shopLinkStatus();
      if (!link.linked) return { ...link, account: null };
      try {
        const a = await shopCall('get_account', {});
        const cards = (a.selectable_instruments ?? []).map((c: any) => {
          const d = c.display ?? c;
          return [d.brand ?? d.card_brand, (d.last_digits ?? d.last4) && `•••• ${d.last_digits ?? d.last4}`].filter(Boolean).join(' ') || d.description || 'Saved card';
        });
        return {
          ...link,
          account: { email: a.buyer?.email ?? null, addresses: (a.addresses ?? []).length, cards, manageUrl: (a.links ?? []).find((l: any) => /manage/.test(l.type ?? l.rel ?? ''))?.url ?? null },
        };
      } catch (err) {
        return { ...shopLinkStatus(), account: null, error: shopErrorText(err) };
      }
    }),
  );
  r.post(
    '/shop/link',
    h(async (req) => {
      try {
        // Own app client → redirect flow; otherwise Shop's device flow (open a link, approve a code).
        if (getSettings().shopping.clientId?.trim()) return { ok: true, url: beginAppLink(appOrigin(req)) };
        return { ok: true, pending: await beginDeviceLink() };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }),
  );
  r.post('/shop/unlink', h(async () => (await unlinkShop(), shopLinkStatus())));
  r.get('/shop/oauth/callback', async (req, res) => {
    const back = (q: string) => res.redirect(`/settings/shopping?${q}`);
    if (req.query.error) return back(`shop_error=${encodeURIComponent(String(req.query.error_description ?? req.query.error))}`);
    try {
      await completeAppLink(String(req.query.state ?? ''), String(req.query.code ?? ''));
      back('shop_linked=1');
    } catch (err) {
      back(`shop_error=${encodeURIComponent(errorMessage(err))}`);
    }
  });

  r.post(
    '/email/test',
    h(async (req) => {
      const body = req.body as EmailAccount;
      const stored = getSettings().email.accounts.find((a) => a.id === body.id);
      const acc = { ...body, password: !body.password || body.password.includes('••••') ? (stored?.password ?? '') : body.password };
      if (!acc.address || !acc.password) return { ok: false, error: 'Enter the address and app password first.' };
      const r = await testAccount(acc);
      if (!r.ok) return { ok: false, error: r.error };
      return r.send === true ? { ok: true, message: 'Connected: reading and sending both work.' } : { ok: true, message: `Reading works (watchers can use it), but sending failed: ${r.send.error}` };
    }),
  );
  r.get('/email/providers', h(() => PROVIDERS));

  // ── Self-built connections (credentials go in here and never come back out) ──
  r.get('/connections', h(() => listConnections()));
  r.put(
    '/connections/:name/secret',
    h((req) => {
      const value = String(req.body?.value ?? '').trim();
      if (value.length > 8000) throw new HttpError(400, 'That credential is too long.');
      setSecret(param(req, 'name'), value);
      emit({ type: 'connections.changed' });
      return { ok: true, hasSecret: !!value };
    }),
  );
  r.delete(
    '/connections/:name',
    h((req) => {
      removeConnection(param(req, 'name'));
      emit({ type: 'connections.changed' });
    }),
  );

  r.post(
    '/calendars/test',
    h(async (req) => {
      const body = req.body as CalendarFeed;
      const stored = getSettings().calendars.find((c) => c.id === body.id);
      const url = !body.url || body.url.includes('••••') ? (stored?.url ?? '') : body.url;
      if (!url) return { ok: false, error: 'Paste the calendar address first.' };
      try {
        return await testFeed({ id: `test:${body.id}`, name: body.name || 'Calendar', url, enabled: true });
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }),
  );

  // ── Sign in with Google (Gmail + Calendar) ──
  r.get('/google', h((req) => ({ accounts: googleAccounts(), redirectUri: `${appOrigin(req)}/api/mcp/oauth/callback`, configured: !!(getSettings().google?.clientId && getSettings().google?.clientSecret) })));
  r.post(
    '/google/link',
    h((req) => {
      try {
        return { url: beginGoogleLink(`${appOrigin(req)}/api/mcp/oauth/callback`, req.body?.hint ? String(req.body.hint) : undefined) };
      } catch (err) {
        return { error: errorMessage(err) };
      }
    }),
  );
  r.delete(
    '/google/:email',
    h((req) => {
      unlinkGoogle(param(req, 'email'));
      syncEmailTools();
      syncCalendarTools();
    }),
  );
  const googleCallback = async (req: Request, res: Response) => {
    const back = (q: string) => res.redirect(`/settings/connectors?${q}`);
    const state = String(req.query.state ?? '');
    if (req.query.error) return back(`google_error=${encodeURIComponent(String(req.query.error_description ?? req.query.error))}`);
    if (!isGoogleState(state)) return back('google_error=' + encodeURIComponent('Sign-in expired or was started elsewhere. Try again.'));
    try {
      const acc = await completeGoogleLink(state, String(req.query.code ?? ''));
      syncEmailTools();
      syncCalendarTools();
      back(`google_linked=${encodeURIComponent(acc.email)}`);
    } catch (err) {
      back(`google_error=${encodeURIComponent(errorMessage(err))}`);
    }
  };

  r.get('/mcp', h(() => mcpStatus()));
  r.post('/mcp/reload', h(async () => (await reloadMcp(), mcpStatus())));
  r.get('/mcp/oauth/info', h((req) => ({ callbackUrl: oauthCallbackUrl(appOrigin(req)) })));
  r.post(
    '/mcp/:id/connect',
    h(async (req) => {
      try {
        const url = await beginOAuth(param(req, 'id'), oauthCallbackUrl(appOrigin(req)));
        return { ok: true, authUrl: url ?? null };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }),
  );
  r.post(
    '/mcp/:id/disconnect',
    h(async (req) => {
      forgetOAuth(param(req, 'id'));
      await reloadMcp();
      return mcpStatus();
    }),
  );
  // The provider redirects the browser here after the user approves (session cookie is sent: same-site top-level GET).
  r.get('/mcp/oauth/callback', async (req, res) => {
    const state = String(req.query.state ?? '');
    // Sign in with Google shares this return address, so the redirect URI already registered keeps working.
    if (state.startsWith('g_')) return googleCallback(req, res);
    const serverId = state ? serverForState(state) : undefined;
    const back = (q: string) => res.redirect(`/settings/connectors?${q}`);
    if (req.query.error) return back(`oauth_error=${encodeURIComponent(String(req.query.error_description ?? req.query.error))}`);
    if (!serverId) return back('oauth_error=' + encodeURIComponent('Sign-in expired or was started elsewhere. Try Connect again.'));
    clearState(state);
    try {
      await completeOAuth(serverId, String(req.query.code ?? ''));
      back(`connected=${encodeURIComponent(serverId)}`);
    } catch (err) {
      back(`oauth_error=${encodeURIComponent(errorMessage(err))}`);
    }
  });

  // ── Push ──
  r.get('/push/key', h(() => ({ key: vapidPublicKey() })));
  r.post('/push/subscribe', h((req) => saveSubscription(req.body)));
  r.post('/push/unsubscribe', h((req) => removeSubscription(String(req.body?.endpoint ?? ''))));
  r.post('/push/test', h(async () => notify({ title: 'Notifications are on', body: `${getSettings().persona.name} can reach you here.`, kind: 'system' })));

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: errorMessage(err) });
  });
  return r;
}
