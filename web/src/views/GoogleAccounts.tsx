import { motion } from 'motion/react';
import { AlertTriangle, CalendarDays, ChevronRight, Mail, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, CopyButton, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';
import type { Settings } from '../lib/types';

type Edit = (fn: (d: Settings) => void) => void;
interface GoogleAccount {
  email: string;
  name?: string;
  linkedAt: number;
  gmail: boolean;
  calendar: boolean;
  broken?: string;
}
interface GoogleState {
  accounts: GoogleAccount[];
  redirectUri: string;
  configured: boolean;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleSection({ draft, edit, saveNow }: { draft: Settings; edit: Edit; saveNow: (next: Settings) => Promise<Settings | null> }) {
  const [st, setSt] = useState<GoogleState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const toast = useStore((s) => s.toast);
  const load = () => void api.get<GoogleState>('/google').then(setSt);
  useEffect(() => {
    load();
    const q = new URLSearchParams(location.search);
    if (q.get('google_linked')) toast({ title: 'Google account linked', body: `${q.get('google_linked')}: Gmail and Calendar are ready.`, tone: 'success' });
    if (q.get('google_error')) toast({ title: "Google sign-in didn't finish", body: q.get('google_error')!, tone: 'error' });
    if (q.get('google_linked') || q.get('google_error')) navigate('/settings/connectors', { replace: true });
    return onServerEvent((ev) => ev.type === 'google.changed' && load());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasClient = !!(draft.google?.clientId && draft.google?.clientSecret);
  async function signIn(hint?: string) {
    setBusy(true);
    const saved = await saveNow(draft);
    if (!saved) return setBusy(false);
    const r = await api.post<{ url?: string; error?: string }>('/google/link', { hint });
    if (r.url) location.href = r.url;
    else {
      toast({ title: "Can't start Google sign-in", body: r.error, tone: 'error' });
      setBusy(false);
    }
  }

  const setupOpen = showSetup || !hasClient;
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Google</h2>
        <Badge tone="outline">Gmail · Calendar</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
        Sign in with Google once, and {draft.persona.name} can read, watch (new mail within seconds) and send Gmail, and read and add Google Calendar events. No app passwords. It uses Google's official sign-in with your own Google Cloud client, which Google requires for self-hosted apps.
      </p>

      <Card className="mt-4 divide-y divide-line">
        {(st?.accounts ?? []).map((a) => (
          <div key={a.email} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
            <GoogleMark />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium">{a.email}</div>
              <div className="text-[11.5px] text-fg-3">Linked {timeAgo(a.linkedAt)}</div>
            </div>
            {a.gmail && (
              <Badge tone="outline">
                <Mail className="mr-1 size-3" /> Gmail
              </Badge>
            )}
            {a.calendar && (
              <Badge tone="outline">
                <CalendarDays className="mr-1 size-3" /> Calendar
              </Badge>
            )}
            {a.broken && (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void signIn(a.email)}>
                Sign in again
              </Button>
            )}
            <button
              aria-label="Unlink"
              onClick={() => confirm(`Unlink ${a.email}? Watchers using its email stop working.`) && void api.del(`/google/${encodeURIComponent(a.email)}`).then(load)}
              className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-danger"
            >
              <Trash2 className="size-3.5" />
            </button>
            {a.broken && (
              <div className="flex basis-full items-start gap-1.5 text-[12px] text-accent">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a.broken}
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Button variant={st?.accounts.length ? 'secondary' : 'primary'} loading={busy} disabled={!hasClient} onClick={() => void signIn()}>
            <GoogleMark /> {st?.accounts.length ? 'Add another Google account' : 'Sign in with Google'}
          </Button>
          {hasClient && (
            <button onClick={() => setShowSetup((s) => !s)} className="inline-flex items-center gap-1 text-[12.5px] text-fg-3 hover:text-fg">
              <ChevronRight className={cx('size-3.5 transition-transform', setupOpen && 'rotate-90')} /> Google Cloud client
            </button>
          )}
          {!hasClient && <span className="text-[12.5px] text-fg-3">Add your Google Cloud client below first (one time, about 5 minutes).</span>}
        </div>
        {setupOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 px-4 py-4 text-[13px]">
            <ol className="list-decimal space-y-2 pl-5 leading-relaxed text-fg-2">
              <li>
                Open{' '}
                <a className="text-tint underline underline-offset-2" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">
                  Google Auth Platform → Clients
                </a>{' '}
                (create a project if asked). If you made a <b>Web application</b> client for the old Google connector, open it; otherwise <b>Create client → Web application</b>.
              </li>
              <li>
                Under <b>Authorized redirect URIs</b>, make sure this exact address is listed (it already is if you set up the old connector):
                {st && (
                  <div className="mt-1 flex items-center gap-1.5 rounded-md border border-line bg-sunken py-1 pl-2.5 pr-1">
                    <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-fg">{st.redirectUri}</code>
                    <CopyButton text={st.redirectUri} />
                  </div>
                )}
                Open Sable at this same address when you sign in. Google needs <b>https</b> with a real domain (your Tailscale <code>ts.net</code> address works) or <code>http://localhost</code>.
              </li>
              <li>
                <b>Audience:</b> in{' '}
                <a className="text-tint underline underline-offset-2" href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noreferrer">
                  Audience
                </a>
                , choose <b>Personal</b> if it's offered (only your account can sign in; no verification and no weekly sign-outs). Otherwise keep <b>External</b> and press <b>Publish app</b>: in "Testing" mode Google signs you out every 7 days. Google will warn that the app isn't verified; it's your own app, so choose <b>Advanced → Go to …</b>.
              </li>
              <li>
                Turn on the{' '}
                <a className="text-tint underline underline-offset-2" href="https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com" target="_blank" rel="noreferrer">
                  Google Calendar API
                </a>{' '}
                for the project. Gmail needs no extra API: it uses Gmail's built-in mail access.
              </li>
              <li>Copy the client's ID and secret here, then press Sign in with Google.</li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client ID">
                <Input value={draft.google?.clientId ?? ''} placeholder="1234-abc.apps.googleusercontent.com" onChange={(e) => edit((d) => void (d.google = { clientSecret: d.google?.clientSecret ?? '', clientId: e.target.value.trim() }))} />
              </Field>
              <Field label="Client secret">
                <Input type="password" autoComplete="off" value={draft.google?.clientSecret ?? ''} onChange={(e) => edit((d) => void (d.google = { clientId: d.google?.clientId ?? '', clientSecret: e.target.value.trim() }))} />
              </Field>
            </div>
            <p className="text-[12px] text-fg-3">Sable asks Google for: your email address, full Gmail access (needed to read, watch and send over Gmail's mail protocol) and your calendar events. Tokens are stored encrypted on your server; unlink any time here or at myaccount.google.com/connections.</p>
          </motion.div>
        )}
      </Card>
    </section>
  );
}
