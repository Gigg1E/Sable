import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import express from 'express';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import { all, get, run } from './db.js';
import { emit } from './events.js';
import { notify } from './push.js';
import { redact } from './safety.js';
import { getSettings, updateSettings, type MailAddress, type MailSettings } from './settings.js';
import { errorMessage, id, now, truncate, untrusted } from './util.js';

/**
 * Sable's own mail (docs/mail.md). The mailbox lives in Sable; two hand-offs go through services
 * that can actually do them from a home connection:
 *   in:  Cloudflare Email Routing → a small Email Worker → POST /mail-in (through a Cloudflare Tunnel)
 *   out: an SMTP relay (Resend, SES, SMTP2GO…) that signs and delivers.
 * The agent address only takes instructions from your allowlisted addresses, and only when the
 * receiving server verified the sender (DMARC, or DKIM aligned with the From domain). Everything
 * else is held, never acted on.
 */

export const mailSettings = (): MailSettings => getSettings().mail;
const lower = (s: string) => s.trim().toLowerCase();

export function mailEnabled() {
  const m = mailSettings();
  return !!(m.enabled && m.domain && m.addresses.length);
}

export function ownAddress(addr: string): MailAddress | undefined {
  return mailSettings().addresses.find((a) => lower(a.address) === lower(addr));
}

/** Allowlist entries are full addresses ("me@school.edu") or whole domains ("@school.edu"). */
export function isOwnSender(addr: string) {
  const a = lower(addr);
  return mailSettings().allowlist.some((e) => {
    const x = lower(e);
    return x.startsWith('@') ? a.endsWith(x) : a === x;
  });
}

// ───────────── Authentication results ─────────────

export interface AuthResult {
  dmarc?: string;
  dkim?: string;
  dkimDomain?: string;
  spf?: string;
  aligned: boolean;
  verified: boolean;
  by?: string;
}

/**
 * Read the Authentication-Results header added by the receiving server we trust (Cloudflare by
 * default). Only the topmost one from that server counts: anything below it came from the sender.
 */
export function readAuth(mail: ParsedMail, fromAddr: string): AuthResult {
  const authserv = lower(mailSettings().authservId || 'mx.cloudflare.net');
  // Topmost first. Cloudflare may record its checks as ARC-Authentication-Results ("i=1; mx.cloudflare.net; …").
  const lines = mail.headerLines
    .filter((h) => h.key === 'authentication-results' || h.key === 'arc-authentication-results')
    .map((h) => h.line.replace(/^(arc-)?authentication-results:\s*/i, '').replace(/^i=\d+;\s*/i, '').replace(/\s+/g, ' '));
  const mine = lines.find((l) => lower(l).startsWith(authserv));
  const fromDomain = lower(fromAddr.split('@')[1] ?? '');
  if (!mine) return { aligned: false, verified: false };
  const pick = (k: string) => new RegExp(`\\b${k}=(\\w+)`, 'i').exec(mine)?.[1]?.toLowerCase();
  const dkimDomain = /\bdkim=pass[^;]*?header\.(?:d|i)=@?([^\s;]+)/i.exec(mine)?.[1]?.toLowerCase();
  const dmarc = pick('dmarc');
  const dkim = pick('dkim');
  const aligned = !!dkimDomain && (fromDomain === dkimDomain || fromDomain.endsWith(`.${dkimDomain}`) || dkimDomain.endsWith(`.${fromDomain}`));
  return { dmarc, dkim, dkimDomain, spf: pick('spf'), aligned, verified: dmarc === 'pass' || (dkim === 'pass' && aligned), by: authserv };
}

// ───────────── Storage ─────────────

export interface MailRow {
  uid: number;
  mailbox: string;
  folder: 'inbox' | 'held' | 'sent' | 'archive';
  message_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  thread_id: string;
  from_addr: string;
  from_name: string | null;
  to_addrs: string | null;
  cc_addrs: string | null;
  subject: string | null;
  date: number;
  text: string | null;
  html: string | null;
  snippet: string | null;
  auth: string | null;
  verdict: string | null;
  attachments: string | null;
  read: number;
  answered: number;
  conversation_id: string | null;
  created_at: number;
}

const addrList = (a?: AddressObject | AddressObject[]) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => v.address ?? '')).filter(Boolean);

function threadFor(inReplyTo: string | null, refs: string[]): string {
  for (const mid of [inReplyTo, ...refs.slice().reverse()].filter(Boolean) as string[]) {
    const hit = get<{ thread_id: string }>('SELECT thread_id FROM mail_messages WHERE message_id = ?', mid);
    if (hit) return hit.thread_id;
  }
  return id('thr_');
}

/** The newest part of a reply, without the quoted history ("On … wrote:", "> …"). */
export function newestPart(text: string): { mine: string; quoted: string } {
  const lines = text.replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l, i) => /^>/.test(l) || /^On .{4,120}wrote:\s*$/.test(l) || (/^-{2,}\s*Original Message\s*-{2,}/i.test(l)) || (/^From:\s/.test(l) && i > 0 && /^\s*$/.test(lines[i - 1] ?? '')));
  if (cut <= 0) return { mine: text.trim(), quoted: '' };
  return { mine: lines.slice(0, cut).join('\n').trim(), quoted: lines.slice(cut).join('\n').trim() };
}

// ───────────── Incoming ─────────────

type LocalListener = (accountId: string) => void;
let localListener: LocalListener | null = null;
/** email.ts registers here so watchers on Sable's own mailboxes fire right away. */
export function onLocalMail(f: LocalListener | null) {
  localListener = f;
}
type CommandHandler = (msg: MailRow, mine: string, quoted: string) => void;
let commandHandler: CommandHandler | null = null;
/** runner wiring (mailAgent.ts): what to do with a verified instruction from you. */
export function onMailCommand(f: CommandHandler) {
  commandHandler = f;
}

export async function ingest(raw: Buffer | string, envelope: { from?: string; to?: string } = {}): Promise<{ uid: number; folder: string; verdict: string } | { ignored: string }> {
  const mail = await simpleParser(raw);
  const from = mail.from?.value[0];
  const fromAddr = lower(envelope.from && !from?.address ? envelope.from : (from?.address ?? envelope.from ?? ''));
  const rcpts = [envelope.to ?? '', ...addrList(mail.to), ...addrList(mail.cc)].map(lower).filter(Boolean);
  const box = rcpts.map(ownAddress).find(Boolean) ?? (envelope.to ? undefined : mailSettings().addresses[0]);
  if (!box) return { ignored: `not addressed to one of your Sable addresses (${rcpts.join(', ') || 'none'})` };
  if (mail.messageId && get('SELECT uid FROM mail_messages WHERE message_id = ? AND mailbox = ?', mail.messageId, lower(box.address))) return { ignored: 'duplicate' };

  const auth = readAuth(mail, fromAddr);
  const own = isOwnSender(fromAddr);
  // Instructions only from you, verified. Unknown senders to the agent address are held, never acted on.
  const verdict = box.purpose === 'agent' ? (own && auth.verified ? 'command' : own ? 'unverified' : 'unknown') : own && auth.verified ? 'you' : 'mail';
  const folder = box.purpose === 'agent' && verdict !== 'command' ? 'held' : 'inbox';
  const refs = (Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : []) as string[];
  const text = (mail.text ?? '').slice(0, 200_000);
  const atts = mail.attachments.slice(0, 20).map((a) => ({ name: a.filename ?? 'file', type: a.contentType, size: a.size }));
  const r = run(
    `INSERT INTO mail_messages (mailbox, folder, message_id, in_reply_to, refs, thread_id, from_addr, from_name, to_addrs, cc_addrs, subject, date, text, html, snippet, auth, verdict, attachments, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lower(box.address), folder, mail.messageId ?? null, mail.inReplyTo ?? null, refs.join(' ') || null, threadFor(mail.inReplyTo ?? null, refs),
    fromAddr, from?.name ?? null, addrList(mail.to).join(', '), addrList(mail.cc).join(', '), mail.subject ?? '(no subject)', (mail.date ?? new Date()).getTime(),
    text, typeof mail.html === 'string' ? mail.html.slice(0, 400_000) : null, truncate(newestPart(text).mine.replace(/\s+/g, ' '), 240),
    JSON.stringify(auth), verdict, JSON.stringify(atts), now(),
  );
  const uid = Number(r.lastInsertRowid);
  const row = get<MailRow>('SELECT * FROM mail_messages WHERE uid = ?', uid)!;
  touchProfile(fromAddr, from?.name ?? null, 'in', { list: !!mail.headers.get('list-unsubscribe'), subject: row.subject ?? '' });
  emit({ type: 'mail.changed', mailbox: row.mailbox });
  localListener?.(`sable:${row.mailbox}`);

  if (verdict === 'command' && commandHandler) {
    const { mine, quoted } = newestPart(text);
    commandHandler(row, mine, quoted);
  } else if (verdict === 'unverified') {
    void notify({ title: 'Held an email that claims to be from you', body: `${fromAddr}: "${row.subject}". It failed sender verification, so Sable didn't act on it. Open Mail → Held to review.`, link: '/mail', kind: 'system' });
  } else if (box.purpose === 'personal') {
    void notify({ title: `${from?.name || fromAddr}`, body: row.subject ?? '', link: '/mail', kind: 'agent' });
  }
  return { uid, folder, verdict };
}

// ───────────── Outgoing ─────────────

function sentSince(ms: number) {
  return get<{ n: number }>("SELECT count(*) n FROM mail_messages WHERE folder = 'sent' AND created_at > ?", now() - ms)?.n ?? 0;
}

export interface SendInput {
  from?: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string | null;
}

/** Send through the relay, keep a copy in Sent. Rate limits apply to everything Sable sends. */
export async function sendDomainMail(input: SendInput): Promise<MailRow> {
  const m = mailSettings();
  if (!mailEnabled()) throw new Error('Sable mail is off. Turn it on in Settings → Mail.');
  if (!m.relay.host) throw new Error('No outgoing relay is set up yet (Settings → Mail → Sending).');
  if (sentSince(3_600_000) >= m.sendPerHour) throw new Error(`Sending limit reached (${m.sendPerHour} an hour). Raise it in Settings → Mail if this is expected.`);
  if (sentSince(86_400_000) >= m.sendPerDay) throw new Error(`Daily sending limit reached (${m.sendPerDay}).`);
  const box = (input.from && ownAddress(input.from)) || m.addresses.find((a) => a.purpose === 'agent') || m.addresses[0];
  const messageId = `<${crypto.randomBytes(12).toString('hex')}@${m.domain}>`;
  const transport = nodemailer.createTransport({ host: m.relay.host, port: m.relay.port, secure: m.relay.secure, auth: m.relay.user ? { user: m.relay.user, pass: m.relay.pass } : undefined, connectionTimeout: 20_000 });
  const text = redact(input.text);
  const subject = redact(input.subject);
  await transport.sendMail({
    from: { name: box.name || getSettings().persona.name, address: box.address },
    to: input.to,
    cc: input.cc?.length ? input.cc : undefined,
    subject,
    text,
    messageId,
    inReplyTo: input.inReplyTo ?? undefined,
    references: input.references ?? undefined,
  });
  const thread = input.inReplyTo ? threadFor(input.inReplyTo, (input.references ?? '').split(/\s+/).filter(Boolean)) : id('thr_');
  const r = run(
    `INSERT INTO mail_messages (mailbox, folder, message_id, in_reply_to, refs, thread_id, from_addr, from_name, to_addrs, cc_addrs, subject, date, text, snippet, verdict, read, created_at)
     VALUES (?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 1, ?)`,
    lower(box.address), messageId, input.inReplyTo ?? null, input.references ?? null, thread, lower(box.address), box.name, input.to.join(', '), (input.cc ?? []).join(', '), subject, now(), text, truncate(text.replace(/\s+/g, ' '), 240), now(),
  );
  for (const to of input.to) touchProfile(lower(to), null, 'out');
  if (input.inReplyTo) run("UPDATE mail_messages SET answered = 1 WHERE message_id = ? AND folder != 'sent'", input.inReplyTo);
  emit({ type: 'mail.changed', mailbox: lower(box.address) });
  return get<MailRow>('SELECT * FROM mail_messages WHERE uid = ?', Number(r.lastInsertRowid))!;
}

/** Reply in-thread to a message (keeps Message-ID/References so mail clients thread it). */
export function replyTo(msg: MailRow, text: string) {
  const refs = [msg.refs, msg.message_id].filter(Boolean).join(' ');
  const subject = /^re:/i.test(msg.subject ?? '') ? (msg.subject ?? '') : `Re: ${msg.subject ?? ''}`;
  return sendDomainMail({ from: msg.mailbox, to: [msg.from_addr], subject, text, inReplyTo: msg.message_id, references: refs || null });
}

// ───────────── Reading (for the email tools and watchers) ─────────────

export function localSearch(mailbox: string, q: { from?: string; subject?: string; text?: string; sinceDays?: number; unread?: boolean; limit?: number }) {
  const where = ['mailbox = ?', "folder = 'inbox'"];
  const args: (string | number)[] = [lower(mailbox)];
  if (q.from) (where.push('(from_addr LIKE ? OR from_name LIKE ?)'), args.push(`%${q.from}%`, `%${q.from}%`));
  if (q.subject) (where.push('subject LIKE ?'), args.push(`%${q.subject}%`));
  if (q.text) (where.push('(text LIKE ? OR subject LIKE ?)'), args.push(`%${q.text}%`, `%${q.text}%`));
  if (q.unread) where.push('read = 0');
  where.push('date > ?');
  args.push(now() - (q.sinceDays ?? 14) * 86_400_000);
  return all<MailRow>(`SELECT * FROM mail_messages WHERE ${where.join(' AND ')} ORDER BY uid DESC LIMIT ?`, ...args, q.limit ?? 15);
}

export function localMessage(mailbox: string, uid: number) {
  return get<MailRow>('SELECT * FROM mail_messages WHERE uid = ? AND mailbox = ?', uid, lower(mailbox));
}

export function listMail(folder: string, limit = 80, before?: number) {
  return all<MailRow>(
    `SELECT uid, mailbox, folder, message_id, thread_id, from_addr, from_name, to_addrs, subject, date, snippet, verdict, auth, read, answered, conversation_id, attachments FROM mail_messages WHERE folder = ? ${before ? 'AND uid < ?' : ''} ORDER BY uid DESC LIMIT ?`,
    ...(before ? [folder, before, limit] : [folder, limit]),
  );
}

export function setMailFolder(uid: number, folder: MailRow['folder']) {
  run('UPDATE mail_messages SET folder = ? WHERE uid = ?', folder, uid);
  emit({ type: 'mail.changed' });
}

export function markRead(uid: number) {
  run('UPDATE mail_messages SET read = 1 WHERE uid = ?', uid);
}

export function deleteMail(uid: number) {
  run('DELETE FROM mail_messages WHERE uid = ?', uid);
  emit({ type: 'mail.changed' });
}

// ───────────── Sender profiles (learned as you use mail) ─────────────

export interface MailProfile {
  address: string;
  name: string | null;
  category: string | null;
  count_in: number;
  count_out: number;
  replied: number;
  first_seen: number;
  last_seen: number;
  summary: string | null;
  summary_at: number | null;
  topics: string | null;
}

/** First guess at what kind of sender this is; refined by the summary job and by what you do. */
function guessCategory(addr: string, meta: { list?: boolean; subject?: string }): string {
  const [user, domain = ''] = addr.split('@');
  if (isOwnSender(addr)) return 'you';
  if (meta.list || /^(no-?reply|newsletter|news|updates|marketing|hello|info|digest)/i.test(user)) return 'newsletter';
  if (/(order|shipped|shipping|delivery|receipt|invoice|your package|tracking)/i.test(meta.subject ?? '') || /(amazon|ups|fedex|usps|shopify|ebay|etsy)\./i.test(domain)) return 'shopping';
  if (/\.edu$/i.test(domain)) return 'school';
  if (/(bank|chase|paypal|venmo|capitalone|wellsfargo|amex)/i.test(domain)) return 'money';
  if (/^(gmail|outlook|hotmail|yahoo|icloud|proton|me)\./i.test(domain)) return 'personal';
  return 'other';
}

function touchProfile(addr: string, name: string | null, dir: 'in' | 'out', meta: { list?: boolean; subject?: string } = {}) {
  if (!addr || ownAddress(addr)) return;
  const p = get<MailProfile>('SELECT * FROM mail_profiles WHERE address = ?', addr);
  if (!p) {
    run(
      'INSERT INTO mail_profiles (address, name, category, count_in, count_out, replied, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      addr, name, guessCategory(addr, meta), dir === 'in' ? 1 : 0, dir === 'out' ? 1 : 0, dir === 'out' ? 1 : 0, now(), now(),
    );
  } else {
    run(
      `UPDATE mail_profiles SET name = COALESCE(?, name), count_in = count_in + ?, count_out = count_out + ?, replied = replied + ?, last_seen = ? WHERE address = ?`,
      name, dir === 'in' ? 1 : 0, dir === 'out' ? 1 : 0, dir === 'out' ? 1 : 0, now(), addr,
    );
  }
}

export function listProfiles() {
  return all<MailProfile>('SELECT * FROM mail_profiles ORDER BY last_seen DESC LIMIT 300');
}

export function setProfileCategory(addr: string, category: string) {
  run('UPDATE mail_profiles SET category = ? WHERE address = ?', category, lower(addr));
}

let ask: ((system: string, prompt: string, signal?: AbortSignal) => Promise<string>) | null = null;
let privacy: { redact: (t: string) => string; local: () => boolean } | null = null;
export function setMailHelpers(q: typeof ask, p: typeof privacy) {
  ask = q;
  privacy = p;
}

/** Every so often, write a short profile of busy senders: who they are to you and what they send. */
export async function summarizeProfiles() {
  if (!ask) return;
  const due = all<MailProfile>('SELECT * FROM mail_profiles WHERE count_in >= 3 AND (summary_at IS NULL OR summary_at < ?) ORDER BY last_seen DESC LIMIT 3', now() - 7 * 86_400_000);
  for (const p of due) {
    const msgs = all<{ subject: string; snippet: string; date: number }>("SELECT subject, snippet, date FROM mail_messages WHERE from_addr = ? AND folder != 'sent' ORDER BY uid DESC LIMIT 12", p.address);
    let sample = msgs.map((m) => `- ${new Date(m.date).toDateString()}: ${m.subject} | ${m.snippet}`).join('\n');
    // Mail is private: a cloud model only sees it with personal details removed.
    if (privacy && !privacy.local()) sample = privacy.redact(sample);
    try {
      const out = await ask(
        'You keep short profiles of email senders for a personal assistant. From the recent messages, reply in exactly two lines:\nCategory: one of personal, work, school, shopping, money, newsletter, service, other\nProfile: one sentence on who this sender is to the user and what they usually send.',
        `Sender: ${p.name ?? ''} <${p.address}>\nMessages from them: ${p.count_in}, replies from the user: ${p.replied}\n${sample}`,
        AbortSignal.timeout(60_000),
      );
      const clean = out.replace(/<think>[\s\S]*?<\/think>/g, '');
      const cat = /Category:\s*(\w+)/i.exec(clean)?.[1]?.toLowerCase();
      const prof = /Profile:\s*(.+)/i.exec(clean)?.[1]?.trim();
      run('UPDATE mail_profiles SET summary = COALESCE(?, summary), category = COALESCE(?, category), summary_at = ? WHERE address = ?', prof ?? null, cat ?? null, now(), p.address);
    } catch (err) {
      console.error('[mail profile]', errorMessage(err));
      run('UPDATE mail_profiles SET summary_at = ? WHERE address = ?', now(), p.address);
    }
  }
}

/** What the model sees about a sender: profile plus how you treat their mail. */
export function profileLine(addr: string) {
  const p = get<MailProfile>('SELECT * FROM mail_profiles WHERE address = ?', lower(addr));
  if (!p) return '';
  return `${p.name ?? p.address} (${p.category ?? 'unknown'}; ${p.count_in} received, you replied ${p.replied}×)${p.summary ? `: ${p.summary}` : ''}`;
}

// ───────────── DNS status ─────────────

export interface DnsCheck {
  key: string;
  label: string;
  ok: boolean;
  found: string;
  expect: string;
}

export async function checkDns(): Promise<DnsCheck[]> {
  const m = mailSettings();
  const d = m.domain.trim();
  if (!d) return [];
  const txt = async (name: string) => (await dns.resolveTxt(name).catch(() => [] as string[][])).map((x) => x.join(''));
  const mx = (await dns.resolveMx(d).catch(() => [])).map((x) => x.exchange.toLowerCase());
  const spf = (await txt(d)).find((t) => t.startsWith('v=spf1')) ?? '';
  const dmarc = (await txt(`_dmarc.${d}`)).find((t) => t.toLowerCase().startsWith('v=dmarc1')) ?? '';
  const dkimName = m.dkimSelector ? `${m.dkimSelector}._domainkey.${d}` : '';
  const dkim = dkimName ? ((await txt(dkimName))[0] ?? (await dns.resolveCname(dkimName).catch(() => [] as string[]))[0] ?? '') : '';
  return [
    { key: 'mx', label: 'Mail comes to Cloudflare (MX)', ok: mx.some((x) => x.endsWith('mx.cloudflare.net')), found: mx.join(', ') || 'none', expect: 'route1/2/3.mx.cloudflare.net (turn on Email Routing in Cloudflare)' },
    { key: 'spf', label: 'Senders allowed for your domain (SPF)', ok: /_spf\.mx\.cloudflare\.net/.test(spf) && (!m.relay.host || spf.includes('include:')), found: spf || 'none', expect: 'v=spf1 include:_spf.mx.cloudflare.net include:<your relay> ~all' },
    { key: 'dkim', label: 'Relay signs your mail (DKIM)', ok: !!dkim, found: dkimName ? (dkim ? 'published' : 'not found') : 'set the selector your relay gave you', expect: dkimName || '<selector>._domainkey.' + d },
    { key: 'dmarc', label: 'Policy for forged mail (DMARC)', ok: !!dmarc, found: dmarc || 'none', expect: `v=DMARC1; p=none; rua=mailto:dmarc@${d} (tighten to quarantine later)` },
  ];
}

// ───────────── The inbound endpoint (public, secret-protected) ─────────────

/** Mounted at /mail-in on the public listener and the main app. The Worker posts the raw message here. */
export function mailInboundRouter() {
  const r = express.Router();
  r.post('/', express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
    const m = mailSettings();
    const given = String(req.headers['x-sable-mail-secret'] ?? '');
    const ok = m.inboundSecret && given.length === m.inboundSecret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(m.inboundSecret));
    if (!mailEnabled() || !ok) return void res.status(404).end();
    ingest(req.body as Buffer, { from: String(req.headers['x-envelope-from'] ?? ''), to: String(req.headers['x-envelope-to'] ?? '') })
      .then((out) => res.json({ ok: true, ...out }))
      .catch((err) => {
        console.error('[mail-in]', errorMessage(err));
        res.status(500).json({ ok: false });
      });
  });
  return r;
}

/** A fresh inbound secret (Settings → Mail → "New secret"). */
export function rotateInboundSecret() {
  const s = structuredClone(getSettings());
  s.mail.inboundSecret = crypto.randomBytes(24).toString('base64url');
  updateSettings(s);
  return s.mail.inboundSecret;
}

export const quoted = (t: string) => untrusted('quoted part of your email', t);
