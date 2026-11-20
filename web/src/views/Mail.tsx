import { AnimatePresence, motion } from 'motion/react';
import { Archive, AtSign, CheckCircle2, Inbox as InboxIcon, MessageSquare, Paperclip, Send, Settings2, ShieldAlert, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Page, PageIntro, Segmented, Select, Sheet, TopBar, listItem } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { dur, ease } from '../lib/motion';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';

type Folder = 'inbox' | 'held' | 'sent' | 'senders';
interface Msg {
  uid: number;
  mailbox: string;
  folder: string;
  from_addr: string;
  from_name: string | null;
  to_addrs: string | null;
  subject: string | null;
  date: number;
  snippet: string | null;
  verdict: string | null;
  read: number;
  answered: number;
  conversation_id: string | null;
  attachments: string | null;
}
interface Full extends Omit<Msg, 'attachments'> {
  text: string | null;
  auth: { verified: boolean; dmarc?: string; dkim?: string; spf?: string; by?: string } | null;
  attachments: { name: string; size: number }[];
  profile: string;
}
interface Profile {
  address: string;
  name: string | null;
  category: string | null;
  count_in: number;
  count_out: number;
  replied: number;
  last_seen: number;
  summary: string | null;
}

const CATS = ['personal', 'work', 'school', 'shopping', 'money', 'newsletter', 'service', 'you', 'other'];
const CAT_COLOR: Record<string, string> = { personal: 'var(--tint)', work: 'var(--accent)', school: 'var(--info)', shopping: 'var(--ok)', money: 'var(--danger)', newsletter: 'var(--fg-3)', you: 'var(--accent)' };

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const h = hue(name);
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size * 0.4, color: `light-dark(hsl(${h} 45% 40%), hsl(${h} 65% 72%))`, background: `hsl(${h} 60% 50% / 0.14)` }}>
      {(name.replace(/[^\p{L}]/gu, '')[0] ?? '?').toUpperCase()}
    </span>
  );
}

const HELD_WHY: Record<string, string> = {
  unverified: 'Says it is from you but failed sender verification',
  unknown: 'From someone not on your list',
};

function MessageSheet({ uid, onClose }: { uid: number | null; onClose: () => void }) {
  const [m, setM] = useState<Full | null>(null);
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    setM(null);
    if (uid != null) void api.get<Full>(`/mail/message/${uid}`).then(setM).catch(() => onClose());
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = async (folder: string, trust = false) => {
    if (!m) return;
    await api.post(`/mail/message/${m.uid}/move`, { folder, trust });
    toast({ title: trust ? `Trusted ${m.from_addr}` : folder === 'archive' ? 'Archived' : 'Moved to Inbox', body: trust ? 'Verified mail from them can now give Sable instructions.' : undefined, tone: 'success' });
    onClose();
  };
  return (
    <Sheet open={uid != null} onClose={onClose} title={m?.subject ?? 'Loading…'} wide>
      {m && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Avatar name={m.from_name || m.from_addr} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{m.from_name || m.from_addr}</div>
              <div className="truncate text-[12.5px] text-fg-3">
                {m.from_addr} → {m.to_addrs} · {new Date(m.date).toLocaleString()}
              </div>
              {m.profile && <div className="mt-1 text-[12.5px] text-fg-2">{m.profile}</div>}
            </div>
            {m.folder !== 'sent' &&
              (m.auth?.verified ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ok/30 bg-ok/10 px-2 py-1 text-[12px] text-ok" title={`Checked by ${m.auth.by}: DMARC ${m.auth.dmarc ?? '—'}, DKIM ${m.auth.dkim ?? '—'}, SPF ${m.auth.spf ?? '—'}`}>
                  <ShieldCheck className="size-3.5" /> Verified sender
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-fg-3" title={`DMARC ${m.auth?.dmarc ?? '—'}, DKIM ${m.auth?.dkim ?? '—'}, SPF ${m.auth?.spf ?? '—'}`}>
                  <ShieldAlert className="size-3.5" /> Not verified
                </span>
              ))}
          </div>
          {m.folder === 'held' && (
            <div className="rounded-lg border border-accent/30 bg-accent-soft px-3.5 py-2.5 text-[13px] text-fg-2">
              <b className="font-medium text-fg">Held.</b> {HELD_WHY[m.verdict ?? ''] ?? 'Not acted on.'} Sable didn't read it as instructions.
            </div>
          )}
          <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel-2/40 px-4 py-3 font-sans text-[13.5px] leading-relaxed">{m.text}</pre>
          {m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {m.attachments.map((a, i) => (
                <span key={i} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] text-fg-2">
                  <Paperclip className="size-3" /> {a.name}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" className="text-danger" onClick={() => void api.del(`/mail/message/${m.uid}`).then(onClose)}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
            <span className="flex-1" />
            {m.conversation_id && (
              <Button onClick={() => navigate(`/chat/${m.conversation_id}`)}>
                <MessageSquare className="size-3.5" /> Open the chat
              </Button>
            )}
            {m.folder === 'held' ? (
              <>
                <Button onClick={() => void move('inbox')}>Move to Inbox</Button>
                {m.verdict === 'unknown' && (
                  <Button variant="primary" onClick={() => void move('inbox', true)}>
                    Trust this sender
                  </Button>
                )}
              </>
            ) : (
              m.folder === 'inbox' && (
                <Button onClick={() => void move('archive')}>
                  <Archive className="size-3.5" /> Archive
                </Button>
              )
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Senders() {
  const [ps, setPs] = useState<Profile[] | null>(null);
  const load = useCallback(() => void api.get<Profile[]>('/mail/profiles').then(setPs), []);
  useEffect(() => load(), [load]);
  if (ps && !ps.length) return <Empty icon={<Users className="size-4" />} title="No senders yet" body="As mail comes and goes, Sable builds a short profile of each sender: who they are to you, what they send, and how you treat their mail." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(ps ?? []).map((p, i) => (
        <motion.div key={p.address} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.out, delay: Math.min(i, 10) * 0.03 } }} className="rounded-xl border border-line bg-panel p-4">
          <div className="flex items-start gap-3">
            <Avatar name={p.name || p.address} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{p.name || p.address}</div>
              <div className="truncate text-[12px] text-fg-3">{p.address}</div>
            </div>
            <Select
              value={p.category ?? 'other'}
              onChange={(e) => void api.patch(`/mail/profiles/${encodeURIComponent(p.address)}`, { category: e.target.value }).then(load)}
              className="h-7 w-auto py-0 text-[12px]"
              style={{ color: CAT_COLOR[p.category ?? ''] }}
            >
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          {p.summary && <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-2">{p.summary}</p>}
          <div className="mt-2.5 flex gap-3 text-[11.5px] tabular-nums text-fg-3">
            <span>{p.count_in} received</span>
            <span>{p.count_out} sent</span>
            <span>you replied {p.replied}×</span>
            <span className="ml-auto">{timeAgo(p.last_seen)}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function MailView() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [data, setData] = useState<{ messages: Msg[]; enabled: boolean; counts: { inbox: number; held: number } } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    if (folder !== 'senders') void api.get<typeof data & object>(`/mail?folder=${folder}`).then(setData);
  }, [folder]);
  useEffect(() => {
    load();
    return onServerEvent((ev) => ev.type === 'mail.changed' && load());
  }, [load]);

  return (
    <>
      <TopBar
        title="Mail"
        actions={
          <Button size="sm" variant="ghost" onClick={() => navigate('/settings/mail')}>
            <Settings2 className="size-3.5" /> Set up
          </Button>
        }
      />
      <Page width="lg">
        <PageIntro title="Mail" description="Sable's mail on your domain. Email it from anywhere and the answer comes back in the same thread. Anything that isn't verifiably from you is held, never acted on." />
        <div className="mb-4">
          <Segmented
            id="mailf"
            size="sm"
            value={folder}
            onChange={(f) => (setFolder(f), setOpen(null))}
            options={[
              { value: 'inbox', label: data?.counts.inbox ? `Inbox · ${data.counts.inbox}` : 'Inbox' },
              { value: 'held', label: data?.counts.held ? `Held · ${data.counts.held}` : 'Held' },
              { value: 'sent', label: 'Sent' },
              { value: 'senders', label: 'Senders' },
            ]}
          />
        </div>
        {folder === 'senders' ? (
          <Senders />
        ) : data && !data.enabled ? (
          <Empty
            icon={<AtSign className="size-4" />}
            title="Sable mail isn't set up yet"
            body="Give Sable an address on your domain, so you can email it from work or school and get answers back."
            action={
              <Button size="sm" variant="primary" onClick={() => navigate('/settings/mail')}>
                Set up mail
              </Button>
            }
          />
        ) : data && !data.messages.length ? (
          <Empty icon={folder === 'held' ? <CheckCircle2 className="size-4" /> : folder === 'sent' ? <Send className="size-4" /> : <InboxIcon className="size-4" />} title={folder === 'held' ? 'Nothing held' : folder === 'sent' ? 'Nothing sent yet' : 'Inbox is empty'} body={folder === 'held' ? 'Mail that isn’t verifiably from you lands here for review.' : undefined} />
        ) : (
          <Card className="overflow-hidden">
            <AnimatePresence initial={false}>
              {(data?.messages ?? []).map((m) => {
                const who = folder === 'sent' ? (m.to_addrs ?? '') : m.from_name || m.from_addr;
                return (
                  <motion.button key={m.uid} layout {...listItem} onClick={() => setOpen(m.uid)} className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-panel-2/50">
                    <Avatar name={who} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cx('truncate text-[13.5px]', !m.read && folder === 'inbox' ? 'font-semibold' : 'font-medium')}>{who}</span>
                        {m.verdict === 'command' && <span className="shrink-0 rounded border border-accent/30 bg-accent-soft px-1.5 text-[10.5px] text-accent">to Sable</span>}
                        {m.answered ? <span className="shrink-0 text-[11px] text-ok">answered</span> : null}
                      </span>
                      <span className="block truncate text-[13px] text-fg-2">{m.subject}</span>
                      <span className="block truncate text-[12px] text-fg-3">{folder === 'held' ? HELD_WHY[m.verdict ?? ''] : m.snippet}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-fg-3">{timeAgo(m.date)}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </Card>
        )}
      </Page>
      <MessageSheet uid={open} onClose={() => (setOpen(null), load())} />
    </>
  );
}
