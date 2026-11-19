import { AnimatePresence, motion } from 'motion/react';
import { Mail, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import type { EmailAccount, Settings } from '../lib/types';

type Edit = (fn: (d: Settings) => void) => void;

const PROVIDERS: { value: EmailAccount['provider']; label: string; help: string }[] = [
  { value: 'gmail', label: 'Gmail', help: 'Turn on 2-Step Verification, then go to myaccount.google.com/apppasswords, create one (any name) and paste the 16 letters here; spaces are removed for you. Use the same Google account as the address.' },
  { value: 'icloud', label: 'iCloud Mail', help: 'account.apple.com → Sign-In and Security → App-Specific Passwords.' },
  { value: 'yahoo', label: 'Yahoo Mail', help: 'Yahoo Account Security → Generate app password.' },
  { value: 'outlook', label: 'Outlook.com', help: 'Microsoft often blocks app passwords for IMAP. If the test fails, use the Microsoft 365 connector below instead.' },
  { value: 'custom', label: 'Other (IMAP/SMTP)', help: "Enter your provider's IMAP and SMTP servers." },
];

export function EmailAccountsSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const [tests, setTests] = useState<Record<string, { ok: boolean; error?: string; message?: string } | 'busy'>>({});
  const accounts = draft.email?.accounts ?? [];
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Email</h2>
        <Badge tone="outline">read · watch · send</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
        Connect a mailbox with an <b className="text-fg">app password</b> (not your normal password). {draft.persona.name} can then search and read mail, watch for new emails from certain senders (noticed within seconds), and send email from it, with your approval unless a routine you approved does it. Works with personal Gmail.
      </p>
      <div className="mt-4 space-y-3">
        <AnimatePresence initial={false}>
          {accounts.map((a, i) => {
            const set = (fn: (x: EmailAccount) => void) => edit((d) => fn(d.email.accounts[i]));
            const t = tests[a.id];
            const p = PROVIDERS.find((x) => x.value === a.provider) ?? PROVIDERS[0];
            return (
              <motion.div key={a.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <Mail className="size-4 shrink-0 text-fg-3" />
                    <Input className="!w-auto flex-1 !border-transparent !bg-transparent !px-0 !text-[14px] font-medium !shadow-none focus:!ring-0" value={a.name} placeholder="Name, e.g. Personal" onChange={(e) => set((x) => void (x.name = e.target.value))} />
                    <button
                      onClick={() => edit((d) => d.email.accounts.forEach((x) => (x.isDefault = x.id === a.id)))}
                      className={cx('h-6 rounded-md border px-2 text-[11.5px]', a.isDefault ? 'border-tint/30 bg-tint-soft text-tint' : 'border-line text-fg-3 hover:text-fg-2')}
                    >
                      {a.isDefault ? 'Default' : 'Make default'}
                    </button>
                    <Toggle size="sm" checked={a.enabled !== false} onChange={(v) => set((x) => void (x.enabled = v))} label="Enabled" />
                    <button onClick={() => edit((d) => void d.email.accounts.splice(i, 1))} aria-label="Remove" className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-danger">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_1fr]">
                    <Field label="Provider">
                      <Select value={a.provider} onChange={(e) => set((x) => void (x.provider = e.target.value as EmailAccount['provider']))}>
                        {PROVIDERS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Email address">
                      <Input type="email" autoComplete="off" value={a.address} placeholder="you@gmail.com" onChange={(e) => set((x) => void (x.address = e.target.value.trim()))} />
                    </Field>
                    <Field label="App password">
                      <Input type="password" autoComplete="new-password" value={a.password} onChange={(e) => set((x) => void (x.password = e.target.value))} />
                    </Field>
                  </div>
                  {a.provider === 'custom' && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      <Field label="IMAP server">
                        <Input value={a.imapHost ?? ''} placeholder="imap.example.com" onChange={(e) => set((x) => void (x.imapHost = e.target.value.trim()))} />
                      </Field>
                      <Field label="IMAP port">
                        <Input type="number" value={a.imapPort ?? 993} onChange={(e) => set((x) => void (x.imapPort = Number(e.target.value)))} />
                      </Field>
                      <Field label="SMTP server">
                        <Input value={a.smtpHost ?? ''} placeholder="smtp.example.com" onChange={(e) => set((x) => void (x.smtpHost = e.target.value.trim()))} />
                      </Field>
                      <Field label="SMTP port">
                        <Input type="number" value={a.smtpPort ?? 465} onChange={(e) => set((x) => void (x.smtpPort = Number(e.target.value)))} />
                      </Field>
                    </div>
                  )}
                  <p className="mt-2 text-[12px] leading-relaxed text-fg-3">{p.help}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      size="sm"
                      loading={t === 'busy'}
                      disabled={!a.address || !a.password}
                      onClick={async () => {
                        setTests((x) => ({ ...x, [a.id]: 'busy' }));
                        const r = await api.post<{ ok: boolean; error?: string; message?: string }>('/email/test', a).catch((err: Error) => ({ ok: false, error: err.message }));
                        setTests((x) => ({ ...x, [a.id]: r }));
                      }}
                    >
                      Test
                    </Button>
                    {t && t !== 'busy' && <span className={cx('min-w-0 flex-1 basis-full text-xs leading-relaxed sm:basis-auto', t.ok ? (t.message?.startsWith('Reading works') ? 'text-accent' : 'text-ok') : 'text-danger')}>{t.ok ? (t.message ?? 'Connected') : t.error}</span>}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
        <Button
          size="sm"
          onClick={() =>
            edit((d) => {
              d.email ??= { accounts: [] };
              let n = d.email.accounts.length + 1;
              let id = `mail-${n}`;
              while (d.email.accounts.some((c) => c.id === id)) id = `mail-${++n}`;
              d.email.accounts.push({ id, name: d.email.accounts.length ? `Mailbox ${n}` : 'Personal', address: '', provider: 'gmail', password: '', isDefault: !d.email.accounts.length, enabled: true });
            })
          }
        >
          <Plus className="size-3.5" /> Add email account
        </Button>
      </div>
    </section>
  );
}
