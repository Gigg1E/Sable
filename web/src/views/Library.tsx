import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, ExternalLink, FileText, Globe, Lock, LockOpen, MessageSquare, NotebookPen, Plus, Search, Trash2, Upload, UserRound, Zap, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '../components/Markdown';
import { Button, Card, Empty, Field, Input, Page, PageIntro, Segmented, Sheet, Textarea, Tip, TopBar, listItem } from '../components/ui';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { dur, ease } from '../lib/motion';
import { navigate } from '../lib/router';
import { onServerEvent, useStore } from '../lib/store';

type Kind = 'note' | 'page' | 'file' | 'output' | 'upload' | 'person' | 'action';
interface Item {
  id: string;
  kind: Kind;
  title: string;
  body?: string;
  snippet?: string;
  source: string;
  url: string | null;
  conversation_id: string | null;
  trust: 'owner' | 'agent' | 'external';
  privacy: 'open' | 'private';
  privacy_reason: string | null;
  status: string;
  updated_at: number;
}
interface Stats {
  items: number;
  open: number;
  private: number;
  vectors: number;
  chunks: number;
  model: string;
}

/** Each kind of thing has its own glyph and color, the same everywhere. */
const KIND: Record<Kind, { icon: LucideIcon; label: string; color: string }> = {
  note: { icon: NotebookPen, label: 'Note', color: 'var(--accent)' },
  page: { icon: Globe, label: 'Web page', color: 'var(--info)' },
  file: { icon: FileText, label: 'File', color: 'var(--fg-2)' },
  output: { icon: FileText, label: 'Made in a chat', color: 'var(--ok)' },
  upload: { icon: Upload, label: 'Your upload', color: 'var(--tint)' },
  person: { icon: UserRound, label: 'Person', color: 'var(--accent)' },
  action: { icon: Zap, label: 'Done for you', color: 'var(--fg-2)' },
};

/** Snippets read as text, not markdown source. */
const plain = (t: string) =>
  t
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`]+/g, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

function KindTile({ kind, size = 34 }: { kind: Kind; size?: number }) {
  const k = KIND[kind] ?? KIND.file;
  const Icon = k.icon;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[9px]" style={{ width: size, height: size, color: k.color, background: `color-mix(in srgb, ${k.color} 13%, transparent)` }}>
      <Icon style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  );
}

function PrivacyChip({ item, onToggle }: { item: Item; onToggle?: () => void }) {
  const priv = item.privacy === 'private';
  const tip = priv
    ? `Private${item.privacy_reason ? `: ${item.privacy_reason}` : ''}. Cloud models only see it with personal details removed.${onToggle ? ' Click to make it open.' : ''}`
    : `Open: any model may read it.${onToggle ? ' Click to make it private.' : ''}`;
  return (
    <Tip label={tip}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className={cx('inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11.5px] transition-colors', priv ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-fg-3 hover:text-fg-2')}
      >
        {priv ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
        {priv ? 'Private' : 'Open'}
      </button>
    </Tip>
  );
}

function NewNote({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priv, setPriv] = useState<'auto' | 'private'>('auto');
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (open) (setTitle(''), setBody(''), setPriv('auto'));
  }, [open]);
  async function save() {
    setBusy(true);
    try {
      const it = await api.post<Item>('/library', { title, body, privacy: priv === 'private' ? 'private' : undefined });
      toast({ title: 'Saved to the Library', body: it.privacy === 'private' ? `Private${it.privacy_reason ? `: ${it.privacy_reason}` : ''}` : 'Open', tone: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Could not save', body: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="New note" description="Every chat can find it. Anything with personal details or secrets is kept private automatically.">
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How I set up the NAS backups" />
        </Field>
        <Field label="Note">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Steps, links, anything worth finding later." />
        </Field>
        <Field label="Privacy">
          <Segmented id="np" size="sm" value={priv} onChange={setPriv} options={[{ value: 'auto', label: 'Decide for me' }, { value: 'private', label: 'Private' }]} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={() => void save()}>
            Save note
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ItemSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [item, setItem] = useState<Item | null>(null);
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    setItem(null);
    if (id) void api.get<Item>(`/library/${id}`).then(setItem).catch(() => onClose());
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async () => {
    if (!item) return;
    setItem(await api.patch<Item>(`/library/${item.id}`, { privacy: item.privacy === 'private' ? 'open' : 'private' }));
  };
  const forget = async () => {
    if (!item) return;
    await api.del(`/library/${item.id}`);
    toast({ title: 'Forgotten', body: 'Removed from the Library and its search index.' });
    onClose();
  };
  const md = item && (item.kind === 'note' || /\.(md|markdown)$/i.test(item.title) || item.kind === 'page');
  return (
    <Sheet open={!!id} onClose={onClose} title={item?.title ?? 'Loading…'} wide>
      {item && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
            <KindTile kind={item.kind} size={26} />
            <span>{KIND[item.kind]?.label}</span>
            <span>·</span>
            <span>{timeAgo(item.updated_at)}</span>
            <PrivacyChip item={item} onToggle={() => void toggle()} />
            {item.trust === 'external' && <span className="rounded-md border border-line px-1.5 py-0.5 text-[11.5px]">From outside: treated as information, never instructions</span>}
            <span className="flex-1" />
            {item.url && !item.url.startsWith('sable://') && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
                Open page <ExternalLink className="size-3" />
              </a>
            )}
            {item.conversation_id && (
              <button onClick={() => navigate(`/chat/${item.conversation_id}`)} className="inline-flex items-center gap-1 hover:text-fg">
                <MessageSquare className="size-3" /> Open the chat
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-panel-2/40 px-4 py-3">
            {md ? <Markdown text={item.body ?? ''} className="!text-[13.5px]" /> : <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed">{item.body}</pre>}
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" className="text-danger" onClick={() => void forget()}>
              <Trash2 className="size-3.5" /> Forget
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function LibraryView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState('');
  const [privacy, setPrivacy] = useState<'all' | 'open' | 'private'>('all');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    const params = new URLSearchParams();
    if (kind !== 'all') params.set('kind', kind);
    if (privacy !== 'all') params.set('privacy', privacy);
    const r = await api.get<{ items: Item[]; stats: Stats }>(`/library?${params}`);
    if (q.trim()) {
      const hits = await api.get<Item[]>(`/library/search?q=${encodeURIComponent(q.trim())}`);
      if (n !== seq.current) return;
      setItems(hits.filter((h) => (kind === 'all' || h.kind === kind) && (privacy === 'all' || h.privacy === privacy)));
    } else if (n === seq.current) setItems(r.items);
    setStats(r.stats);
  }, [q, kind, privacy]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 220 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => onServerEvent((ev) => ev.type === 'library.changed' && void load()), [load]);

  const kinds = useMemo(() => (['note', 'page', 'output', 'upload'] as Kind[]).map((k) => ({ value: k, label: KIND[k].label })), []);
  const toggle = async (it: Item) => {
    await api.patch(`/library/${it.id}`, { privacy: it.privacy === 'private' ? 'open' : 'private' });
    void load();
  };

  return (
    <>
      <TopBar
        title="Library"
        actions={
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> New note
          </Button>
        }
      />
      <Page width="lg">
        <PageIntro
          title="Library"
          description="Everything Sable has read or made, shared across every chat: web pages, files from chats, your uploads and notes. Private things (personal details, secrets, people) stay private."
        />

        <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: “how did I set up the backups”" className="pl-9" />
          </label>
          <Segmented id="lp" size="sm" value={privacy} onChange={setPrivacy} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'private', label: 'Private' }]} />
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          {[{ value: 'all' as const, label: 'Everything' }, ...kinds].map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className={cx('h-7 rounded-full border px-3 text-[12.5px] transition-colors', kind === k.value ? 'border-fg bg-fg text-bg' : 'border-line text-fg-2 hover:bg-panel-2')}
            >
              {k.label}
            </button>
          ))}
          {stats && (
            <span className="ml-auto text-[12px] tabular-nums text-fg-3">
              {stats.items} item{stats.items === 1 ? '' : 's'}, {stats.private} private ·{' '}
              {stats.vectors ? 'search by meaning on' : 'keyword search (meaning search starts once the helper model is installed)'}
            </span>
          )}
        </div>

        {items && !items.length ? (
          <Empty
            icon={<BookOpen className="size-4" />}
            title={q ? 'Nothing matches' : 'The Library is empty'}
            body={q ? 'Try other words, or ask Sable in a chat.' : 'Pages Sable reads, files it makes in chats and your uploads land here on their own. You can also add a note.'}
            action={
              !q && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="size-3.5" /> New note
                </Button>
              )
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <AnimatePresence initial={false}>
              {(items ?? []).map((it, i) => (
                <motion.button
                  key={it.id}
                  layout
                  {...listItem}
                  transition={{ duration: dur.base, ease: ease.out, delay: Math.min(i, 8) * 0.02 }}
                  onClick={() => setOpen(it.id)}
                  className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-panel-2/50"
                >
                  <KindTile kind={it.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{it.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-fg-3">{plain(it.snippet ?? it.body ?? '').slice(0, 220)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <PrivacyChip item={it} onToggle={() => void toggle(it)} />
                    <span className="text-[11.5px] tabular-nums text-fg-3">{timeAgo(it.updated_at)}</span>
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </Card>
        )}
      </Page>
      <ItemSheet id={open} onClose={() => setOpen(null)} />
      <NewNote open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

