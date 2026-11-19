import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { AGENT_PROXY } from './net.js';
import { getSettings, type EmailAccount } from './settings.js';
import { errorMessage, truncate } from './util.js';

/**
 * Email over IMAP (read, search, watch) and SMTP (send), with an app password. Works with personal
 * Gmail, iCloud and Yahoo without any developer setup. New mail is noticed within seconds through
 * IMAP IDLE (a live connection), with polling as the fallback.
 */

export const PROVIDERS: Record<string, { label: string; imap: string; imapPort: number; smtp: string; smtpPort: number; help: string }> = {
  gmail: { label: 'Gmail', imap: 'imap.gmail.com', imapPort: 993, smtp: 'smtp.gmail.com', smtpPort: 465, help: 'Google Account → Security → 2-Step Verification → App passwords' },
  icloud: { label: 'iCloud Mail', imap: 'imap.mail.me.com', imapPort: 993, smtp: 'smtp.mail.me.com', smtpPort: 587, help: 'account.apple.com → Sign-In and Security → App-Specific Passwords' },
  yahoo: { label: 'Yahoo Mail', imap: 'imap.mail.yahoo.com', imapPort: 993, smtp: 'smtp.mail.yahoo.com', smtpPort: 465, help: 'Yahoo Account Security → Generate app password' },
  outlook: { label: 'Outlook.com', imap: 'outlook.office365.com', imapPort: 993, smtp: 'smtp-mail.outlook.com', smtpPort: 587, help: 'Microsoft may block app passwords for IMAP; if it fails, use the Microsoft 365 connector instead' },
  custom: { label: 'Other (IMAP)', imap: '', imapPort: 993, smtp: '', smtpPort: 465, help: "Use your provider's IMAP and SMTP settings" },
};

/**
 * Providers show app passwords in groups ("abcd efgh ijkl mnop"); the spaces aren't part of it and
 * some servers reject them. Custom servers keep the password exactly as typed.
 */
export function appPassword(acc: EmailAccount) {
  return acc.provider === 'custom' ? acc.password : acc.password.replace(/\s+/g, '');
}

function server(acc: EmailAccount) {
  const p = PROVIDERS[acc.provider] ?? PROVIDERS.custom;
  return {
    imap: acc.imapHost || p.imap,
    imapPort: acc.imapPort || p.imapPort,
    smtp: acc.smtpHost || p.smtp,
    smtpPort: acc.smtpPort || p.smtpPort,
  };
}

/** Pick an account by id, address or name (case-insensitive); default account otherwise. */
export function emailAccount(which?: string): EmailAccount {
  const list = (getSettings().email?.accounts ?? []).filter((a) => a.enabled !== false && a.address && a.password);
  if (!list.length) throw new Error('No email account is connected. The user can add one in Settings → Connectors → Email (an app password is needed).');
  if (which) {
    const w = which.toLowerCase();
    const hit = list.find((a) => a.id === which || a.address.toLowerCase() === w || a.name.toLowerCase() === w || a.address.toLowerCase().includes(w));
    if (hit) return hit;
  }
  return list.find((a) => a.isDefault) ?? list[0];
}

function imapClient(acc: EmailAccount) {
  const s = server(acc);
  return new ImapFlow({
    host: s.imap,
    port: s.imapPort,
    // 993 is TLS from the start; other ports (local bridges like Proton Mail Bridge) upgrade with STARTTLS when offered.
    secure: s.imapPort === 993,
    auth: { user: (acc.user || acc.address).trim(), pass: appPassword(acc) },
    logger: false,
    ...(AGENT_PROXY ? { proxy: AGENT_PROXY } : {}),
  });
}

async function withInbox<T>(acc: EmailAccount, fn: (c: ImapFlow) => Promise<T>, folder = 'INBOX'): Promise<T> {
  const c = imapClient(acc);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(folder);
    try {
      return await fn(c);
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}

export interface MailSummary {
  uid: number;
  from: string;
  fromAddress: string;
  subject: string;
  date: string;
  unread: boolean;
  snippet?: string;
}

function summarize(m: FetchMessageObject, snippet?: string): MailSummary {
  const f = m.envelope?.from?.[0];
  return {
    uid: m.uid,
    from: f?.name ? `${f.name} <${f.address}>` : (f?.address ?? 'unknown'),
    fromAddress: (f?.address ?? '').toLowerCase(),
    subject: m.envelope?.subject ?? '(no subject)',
    date: (m.envelope?.date ?? m.internalDate ?? new Date()).toString(),
    unread: !m.flags?.has('\\Seen'),
    snippet,
  };
}

async function textOf(source?: Buffer) {
  if (!source) return '';
  const parsed = await simpleParser(source);
  return (parsed.text ?? (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, ' ') : '')).replace(/\s+\n/g, '\n').trim();
}

/** Search the inbox: newest first. */
export async function searchMail(acc: EmailAccount, q: { from?: string; subject?: string; text?: string; sinceDays?: number; unread?: boolean; limit?: number }): Promise<MailSummary[]> {
  return withInbox(acc, async (c) => {
    const criteria: Record<string, unknown> = {};
    if (q.from) criteria.from = q.from;
    if (q.subject) criteria.subject = q.subject;
    if (q.text) criteria.body = q.text;
    if (q.unread) criteria.seen = false;
    criteria.since = new Date(Date.now() - Math.min(Math.max(q.sinceDays ?? 14, 1), 365) * 86_400_000);
    const uids = ((await c.search(criteria, { uid: true })) || []).slice(-(q.limit ?? 20)).reverse();
    if (!uids.length) return [];
    const out: MailSummary[] = [];
    for await (const m of c.fetch(uids, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true })) out.push(summarize(m));
    return out.sort((a, b) => b.uid - a.uid);
  });
}

export async function readMail(acc: EmailAccount, uid: number) {
  return withInbox(acc, async (c) => {
    const m = await c.fetchOne(String(uid), { uid: true, envelope: true, source: true, flags: true }, { uid: true });
    if (!m) throw new Error(`No message with id ${uid}.`);
    const text = await textOf(m.source);
    const to = (m.envelope?.to ?? []).map((t) => t.address).join(', ');
    return { ...summarize(m), to, text: truncate(text, 20_000) };
  });
}

/** Highest UID in the inbox right now (the baseline for "new" mail). */
export async function latestUid(acc: EmailAccount): Promise<number> {
  return withInbox(acc, async (c) => {
    const mb = c.mailbox;
    return mb ? Math.max(0, Number(mb.uidNext) - 1) : 0;
  });
}

/** Messages that arrived after `afterUid`, with a short text snippet each. */
export async function mailAfter(acc: EmailAccount, afterUid: number, max = 25): Promise<MailSummary[]> {
  return withInbox(acc, async (c) => {
    const out: MailSummary[] = [];
    for await (const m of c.fetch(`${afterUid + 1}:*`, { uid: true, envelope: true, flags: true, internalDate: true, source: { maxLength: 60_000 } }, { uid: true })) {
      if (m.uid <= afterUid) continue; // "N:*" always returns the last message
      out.push(summarize(m, truncate(await textOf(m.source).catch(() => ''), 1500)));
      if (out.length >= max) break;
    }
    return out;
  });
}

export async function sendMail(acc: EmailAccount, msg: { to: string; cc?: string; subject: string; text: string }) {
  const s = server(acc);
  const t = nodemailer.createTransport({
    host: s.smtp,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    auth: { user: (acc.user || acc.address).trim(), pass: appPassword(acc) },
    ...(AGENT_PROXY ? { proxy: AGENT_PROXY } : {}),
  });
  const info = await t.sendMail({ from: acc.name && acc.name !== acc.address ? `"${acc.name}" <${acc.address}>` : acc.address, to: msg.to, cc: msg.cc, subject: msg.subject, text: msg.text });
  return info.messageId;
}

type Problem = { ok: false; part: 'read' | 'send'; error: string };

/** Explain a mail failure in plain words: wrong password vs. can't reach the server vs. something else. */
function explain(acc: EmailAccount, part: 'read' | 'send', err: unknown): Problem {
  const e = err as { authenticationFailed?: boolean; responseCode?: number; responseText?: string; response?: string; code?: string; message?: string; serverResponseCode?: string };
  const s = server(acc);
  const host = part === 'read' ? `${s.imap}:${s.imapPort}` : `${s.smtp}:${s.smtpPort}`;
  const said = (e.responseText || e.response || e.message || '').toString().replace(/\s+/g, ' ').trim().slice(0, 200);
  const auth = e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535 || /AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|authentication failed|\[AUTH\]/i.test(said);
  if (auth) {
    const tips =
      acc.provider === 'gmail'
        ? 'Check: the address is exactly the Google account the app password was made in; 2-Step Verification is on; you copied the newest 16-letter app password (old ones stop working when you change your Google password); and it isn\'t a work/school account whose admin blocks app passwords.'
        : acc.provider === 'icloud'
          ? 'Use your full @icloud.com (or @me.com) address and an app-specific password from account.apple.com.'
          : acc.provider === 'outlook'
            ? 'Microsoft has turned off app passwords for IMAP on most Outlook.com accounts, so this may not be fixable here; use the Microsoft 365 connector instead.'
            : 'Check the address, login name and app password.';
    return { ok: false, part, error: `The ${part === 'read' ? 'mail' : 'sending'} server (${host}) rejected the sign-in. ${tips}${said ? ` Server said: "${said}"` : ''}` };
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(e.code ?? said)) return { ok: false, part, error: `Couldn't find ${host}. Check the server name${AGENT_PROXY ? ', or your agent proxy/VPN' : ''}.` };
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|timeout|socket|proxy|tunnel/i.test(`${e.code ?? ''} ${said}`))
    return {
      ok: false,
      part,
      error: `Couldn't connect to ${host}${AGENT_PROXY ? ' through the agent proxy (VPN). Many VPN proxies only allow web ports, not mail ports (993/465/587); see docs/automations.md' : ' (a firewall may block mail ports 993/465/587)'}. ${said}`.trim(),
    };
  if (/certificate|self.signed|TLS|SSL/i.test(said)) return { ok: false, part, error: `Secure connection to ${host} failed: ${said}` };
  return { ok: false, part, error: `${host}: ${said || 'unknown error'}` };
}

/** Check reading (IMAP) and sending (SMTP) separately, so the error says which part failed and why. */
export async function testAccount(acc: EmailAccount): Promise<{ ok: true; latestUid: number; send: true | Problem } | Problem> {
  let uid: number;
  try {
    uid = await latestUid(acc);
  } catch (err) {
    return explain(acc, 'read', err);
  }
  try {
    const s = server(acc);
    await nodemailer
      .createTransport({ host: s.smtp, port: s.smtpPort, secure: s.smtpPort === 465, auth: { user: (acc.user || acc.address).trim(), pass: appPassword(acc) }, connectionTimeout: 10_000, ...(AGENT_PROXY ? { proxy: AGENT_PROXY } : {}) })
      .verify();
    return { ok: true, latestUid: uid, send: true };
  } catch (err) {
    return { ok: true, latestUid: uid, send: explain(acc, 'send', err) };
  }
}

// ───────────── Live new-mail listeners (IMAP IDLE) ─────────────

const listeners = new Map<string, { client: ImapFlow; stop: boolean }>();

/** Keep a live connection for each account in `ids`; call `onNew(accountId)` when mail arrives. */
export function syncMailListeners(ids: Set<string>, onNew: (accountId: string) => void) {
  for (const [id, l] of listeners) {
    if (!ids.has(id)) {
      l.stop = true;
      void l.client.logout().catch(() => {});
      listeners.delete(id);
    }
  }
  for (const id of ids) {
    if (listeners.has(id)) continue;
    let acc: EmailAccount;
    try {
      acc = emailAccount(id);
    } catch {
      continue;
    }
    const start = (delay: number) => {
      const entry = { client: imapClient(acc), stop: false };
      listeners.set(id, entry);
      setTimeout(async () => {
        if (entry.stop) return;
        try {
          entry.client.on('exists', () => onNew(id));
          entry.client.on('close', () => {
            if (!entry.stop && listeners.get(id) === entry) start(60_000); // reconnect
          });
          entry.client.on('error', () => {});
          await entry.client.connect();
          await entry.client.mailboxOpen('INBOX'); // ImapFlow idles automatically while a mailbox is open
        } catch (err) {
          console.error(`[email ${acc.address}] live connection failed: ${errorMessage(err)}; polling still works`);
          if (!entry.stop && listeners.get(id) === entry) start(5 * 60_000);
        }
      }, delay).unref?.();
    };
    start(0);
  }
}
