import { motion } from 'motion/react';
import { CheckCircle2, CircleDashed, KeyRound, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CopyButton, Field, Input, Segmented, Select, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import type { MailSettings, Settings } from '../lib/types';

type Edit = (fn: (d: Settings) => void) => void;
interface DnsCheck {
  key: string;
  label: string;
  ok: boolean;
  found: string;
  expect: string;
}

const RELAYS: Record<string, { host: string; port: number; secure: boolean; user?: string; note: string }> = {
  resend: { host: 'smtp.resend.com', port: 465, secure: true, user: 'resend', note: 'Password = your Resend API key. Free tier: 3,000 emails a month.' },
  ses: { host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false, note: 'SMTP credentials from the SES console (not your AWS keys). Change the region if yours differs.' },
  smtp2go: { host: 'mail.smtp2go.com', port: 587, secure: false, note: 'An SMTP user you create in SMTP2GO.' },
  postmark: { host: 'smtp.postmarkapp.com', port: 587, secure: false, note: 'Username and password are both your Server API token.' },
  custom: { host: '', port: 587, secure: false, note: 'Any SMTP submission server.' },
};

const blank: MailSettings = { enabled: false, domain: '', addresses: [], inboundSecret: '', authservId: 'mx.cloudflare.net', allowlist: [], relay: { host: '', port: 587, secure: false, user: '', pass: '' }, dkimSelector: '', backupForward: '', sendPerHour: 20, sendPerDay: 60 };

/** Settings → Mail: Sable's own mail on your domain. Server-side steps are in docs/mail.md. */
export function MailSection({ draft, edit, saveNow }: { draft: Settings; edit: Edit; saveNow: (next: Settings) => Promise<Settings | null> }) {
  const m = draft.mail ?? blank;
  const set = (fn: (x: MailSettings) => void) => edit((d) => fn((d.mail ??= structuredClone(blank))));
  const toast = useStore((s) => s.toast);
  const [dns, setDns] = useState<DnsCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [relayKind, setRelayKind] = useState(() => Object.entries(RELAYS).find(([, r]) => r.host && r.host === m.relay.host)?.[0] ?? (m.relay.host ? 'custom' : 'resend'));
  const [newAllow, setNewAllow] = useState('');
  const [testing, setTesting] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setDns(await api.get<DnsCheck[]>('/mail/dns'));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (m.domain) void check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const inboundUrl = `${location.origin.replace(/:\d+$/, '')}/mail-in`;
  const revealSecret = async (rotate = false) => {
    if (rotate || !m.inboundSecret) {
      const r = await api.post<{ secret: string }>('/mail/secret');
      setSecret(r.secret);
      toast({ title: 'New inbound secret', body: 'Paste it into the Worker (SABLE_SECRET). The old one stops working.', tone: 'success' });
    } else setSecret((await api.get<{ secret: string }>('/mail/secret')).secret);
  };
  const testSend = async () => {
    setTesting(true);
    try {
      await saveNow(draft);
      const r = await api.post<{ to: string }>('/mail/test-send');
      toast({ title: 'Test sent', body: `Check ${r.to}. Reply to it to talk to Sable by email.`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Test failed', body: (err as Error).message, tone: 'error' });
    } finally {
      setTesting(false);
    }
  };
  const done = dns?.filter((d) => d.ok).length ?? 0;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold">Sable mail</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
              Your domain's mail, kept inside Sable. Email Sable from work or school and get answers back in the same thread. Only your own addresses can give it instructions, and only when the sender is verified.
              Server-side setup (Cloudflare, the relay, DNS) is in <code className="font-mono text-[12px]">docs/mail.md</code>.
            </p>
          </div>
          <Toggle checked={m.enabled} onChange={(v) => set((x) => void (x.enabled = v))} label="Sable mail on" />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Your domain">
            <Input value={m.domain} onChange={(e) => set((x) => void (x.domain = e.target.value.trim().toLowerCase()))} placeholder="yourdomain.com" />
          </Field>
          <Field label="Backup address" hint="Where the Worker forwards mail if Sable is offline">
            <Input value={m.backupForward} onChange={(e) => set((x) => void (x.backupForward = e.target.value.trim()))} placeholder="you@gmail.com" />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold">Addresses</h3>
        <p className="mt-1 text-[12.5px] text-fg-3">The agent address takes instructions. Personal addresses are mailboxes for you that Sable can read and watch.</p>
        <div className="mt-3 space-y-2">
          {m.addresses.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input className="min-w-[180px] flex-1" value={a.address} onChange={(e) => set((x) => void (x.addresses[i].address = e.target.value.trim().toLowerCase()))} placeholder={`sable@${m.domain || 'yourdomain.com'}`} />
              <Input className="w-32" value={a.name} onChange={(e) => set((x) => void (x.addresses[i].name = e.target.value))} placeholder="Name" />
              <Segmented id={`ap${i}`} size="sm" value={a.purpose} onChange={(v) => set((x) => void (x.addresses[i].purpose = v))} options={[{ value: 'agent', label: 'Agent' }, { value: 'personal', label: 'Personal' }]} />
              <button onClick={() => set((x) => void x.addresses.splice(i, 1))} className="flex size-8 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-danger" title="Remove">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set((x) => void x.addresses.push({ address: m.domain ? `sable@${m.domain}` : '', name: 'Sable', purpose: x.addresses.some((y) => y.purpose === 'agent') ? 'personal' : 'agent' }))}>
            <Plus className="size-3.5" /> Add address
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold">Who can give Sable instructions</h3>
        <p className="mt-1 text-[12.5px] text-fg-3">Your own addresses (work, school, personal). Add a whole domain as <span className="font-mono">@school.edu</span>. Mail from anyone else to the agent address is held, never acted on.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.allowlist.map((a, i) => (
            <span key={i} className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-panel-2 pl-2 pr-1 text-[12.5px]">
              {a}
              <button onClick={() => set((x) => void x.allowlist.splice(i, 1))} className="flex size-5 items-center justify-center rounded text-fg-3 hover:text-danger">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input value={newAllow} onChange={(e) => setNewAllow(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newAllow.trim() && (set((x) => void x.allowlist.push(newAllow.trim().toLowerCase())), setNewAllow(''))} placeholder="me@work.com" />
          <Button size="sm" disabled={!newAllow.trim()} onClick={() => (set((x) => void x.allowlist.push(newAllow.trim().toLowerCase())), setNewAllow(''))}>
            Add
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold">Receiving</h3>
        <p className="mt-1 text-[12.5px] text-fg-3">Cloudflare Email Routing hands each message to a small Worker, which posts it here through a Cloudflare Tunnel.</p>
        <div className="mt-3 space-y-3">
          <Field label="Inbound address for the Worker" hint="Your tunnel's public hostname + /mail-in (the Tunnel should point at Sable's public port)">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[12px]">https://mail.{m.domain || 'yourdomain.com'}/mail-in</code>
              <CopyButton text={`https://mail.${m.domain || 'yourdomain.com'}/mail-in`} />
            </div>
          </Field>
          <Field label="Inbound secret" hint="The Worker sends it with every message; anything without it gets a 404">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[12px]">{secret ?? (m.inboundSecret ? '••••••••' : 'not created yet')}</code>
              {secret && <CopyButton text={secret} />}
              <Button size="sm" variant="ghost" onClick={() => void revealSecret(false)}>
                <KeyRound className="size-3.5" /> {m.inboundSecret ? 'Show' : 'Create'}
              </Button>
              {m.inboundSecret && (
                <Button size="sm" variant="ghost" onClick={() => void revealSecret(true)}>
                  <RefreshCw className="size-3.5" /> New
                </Button>
              )}
            </div>
          </Field>
          <p className="text-[12px] text-fg-3">
            Local address for testing on the server itself: <span className="font-mono">{inboundUrl}</span>
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold">Sending</h3>
        <p className="mt-1 text-[12.5px] text-fg-3">A relay signs and delivers Sable's replies, so they land in inboxes instead of spam (home internet can't send mail directly).</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Relay">
            <Select
              value={relayKind}
              onChange={(e) => {
                const k = e.target.value;
                setRelayKind(k);
                const r = RELAYS[k];
                if (k !== 'custom') set((x) => void (x.relay = { ...x.relay, host: r.host, port: r.port, secure: r.secure, user: r.user ?? x.relay.user }));
              }}
            >
              <option value="resend">Resend</option>
              <option value="ses">Amazon SES</option>
              <option value="smtp2go">SMTP2GO</option>
              <option value="postmark">Postmark</option>
              <option value="custom">Other SMTP</option>
            </Select>
          </Field>
          <Field label="DKIM selector" hint="From the relay's domain setup, for the DNS check">
            <Input value={m.dkimSelector} onChange={(e) => set((x) => void (x.dkimSelector = e.target.value.trim()))} placeholder="resend" />
          </Field>
          <Field label="SMTP host">
            <Input value={m.relay.host} onChange={(e) => set((x) => void (x.relay.host = e.target.value.trim()))} placeholder="smtp.resend.com" />
          </Field>
          <Field label="Port">
            <Input type="number" value={m.relay.port} onChange={(e) => set((x) => void ((x.relay.port = Number(e.target.value)), (x.relay.secure = Number(e.target.value) === 465)))} />
          </Field>
          <Field label="Username">
            <Input value={m.relay.user} onChange={(e) => set((x) => void (x.relay.user = e.target.value))} autoComplete="off" />
          </Field>
          <Field label="Password / API key" hint="Never shown to the AI">
            <Input type="password" value={m.relay.pass} onChange={(e) => set((x) => void (x.relay.pass = e.target.value))} autoComplete="new-password" />
          </Field>
          <Field label="Max per hour">
            <Input type="number" min={1} value={m.sendPerHour} onChange={(e) => set((x) => void (x.sendPerHour = Number(e.target.value)))} />
          </Field>
          <Field label="Max per day">
            <Input type="number" min={1} value={m.sendPerDay} onChange={(e) => set((x) => void (x.sendPerDay = Number(e.target.value)))} />
          </Field>
        </div>
        <p className="mt-2 text-[12px] text-fg-3">{RELAYS[relayKind]?.note}</p>
        <div className="mt-3">
          <Button size="sm" loading={testing} onClick={() => void testSend()}>
            <Send className="size-3.5" /> Save and send a test to me
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-[14px] font-semibold">DNS for {m.domain || 'your domain'}</h3>
          {dns && <Badge tone={done === dns.length ? 'ok' : 'default'}>{done}/{dns.length} ready</Badge>}
          <Button size="sm" variant="ghost" loading={checking} disabled={!m.domain} onClick={() => void (saveNow(draft).then(check))}>
            <RefreshCw className="size-3.5" /> Check
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {(dns ?? []).map((d, i) => (
            <motion.div key={d.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
              {d.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-3" />}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{d.label}</div>
                <div className={cx('mt-0.5 break-all font-mono text-[11.5px]', d.ok ? 'text-fg-3' : 'text-fg-2')}>{d.ok ? d.found : `found: ${d.found}`}</div>
                {!d.ok && <div className="mt-1 break-all text-[12px] text-fg-3">add: <span className="font-mono">{d.expect}</span></div>}
              </div>
            </motion.div>
          ))}
          {!dns && <p className="text-[12.5px] text-fg-3">Enter your domain and press Check.</p>}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => navigate('/mail')}>
          Open Mail →
        </Button>
      </div>
    </div>
  );
}
