import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Download, ExternalLink, File, FileCode2, FileImage, FileSpreadsheet, FileText, FileArchive, Globe } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { cx } from '../lib/format';
import { onServerEvent } from '../lib/store';
import { usePanel } from '../lib/panel';
import type { AnyCard, CommerceCard, FileCardData, ImagesCardData, LinkItem, LinksCardData } from '../lib/types';
import { CommerceCardView } from './CommerceCards';
import { Markdown } from './Markdown';
import { CopyButton } from './ui';

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileGlyph({ name, className }: { name: string; className?: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const Icon = /^(png|jpe?g|gif|webp|avif|svg|heic)$/.test(ext)
    ? FileImage
    : /^(csv|tsv|xlsx?|ods)$/.test(ext)
      ? FileSpreadsheet
      : /^(zip|gz|tgz|tar|7z|rar)$/.test(ext)
        ? FileArchive
        : /^(js|mjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|cs|php|sh|sql|json|ya?ml|toml|html?|css|xml)$/.test(ext)
          ? FileCode2
          : /^(md|txt|pdf|docx?|rtf|odt|log)$/.test(ext)
            ? FileText
            : File;
  return (
    <span className={cx('relative flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-fg-2', className)}>
      <Icon className="size-4" strokeWidth={1.7} />
      {ext && ext.length <= 4 && <span className="absolute -bottom-1 rounded bg-fg px-1 font-mono text-[8px] font-semibold uppercase leading-[11px] text-bg">{ext}</span>}
    </span>
  );
}

const fileUrl = (p: string, download?: boolean, v?: number) => `/api/files/raw?path=${encodeURIComponent(p)}${download ? '&download=1' : ''}${v ? `&v=${Math.round(v)}` : ''}`;

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * A file the agent mentioned by name in its text. Shows the real file card when the file exists,
 * and says plainly when it doesn't (the model claimed a file it never saved).
 */
/** Files already shown as cards in this turn: a later mention becomes a compact download row, not a second card. */
export const ShownFiles = createContext<Set<string>>(new Set());
/** The chat a file mention belongs to, so a bare name finds that chat's file. */
export const ChatId = createContext<string>('');

export function FileRef({ path, inline }: { path: string; inline?: boolean }) {
  const shown = useContext(ShownFiles);
  const chat = useContext(ChatId);
  const name = path.replace(/^(file|sandbox|attachment):\/*/i, '').split('/').pop() || path;
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [resolved, setResolved] = useState<FileCardData | null>(null);
  useEffect(() => {
    let off = false;
    void fetch(`/api/files/meta?path=${encodeURIComponent(path)}${chat ? `&chat=${encodeURIComponent(chat)}` : ''}`, { credentials: 'same-origin' }).then(async (r) => {
      if (off) return;
      if (!r.ok) return setState('missing');
      setResolved(await r.json());
      setState('ok');
    });
    return () => {
      off = true;
    };
  }, [path, chat]);
  if (inline) {
    return state === 'ok' && resolved ? (
      <a href={fileUrl(resolved.path, true)} download={resolved.name} className="source-chip" title={`Download ${resolved.name}`}>
        <Download className="size-3" /> <span className="truncate">{resolved.name}</span>
      </a>
    ) : (
      <span className={cx('source-chip', state === 'missing' && 'line-through opacity-70')} title={state === 'missing' ? 'Not found in the workspace' : undefined}>
        <span className="truncate">{name}</span>
      </span>
    );
  }
  if (state === 'ok' && resolved && shown.has(resolved.path)) {
    return (
      <a href={fileUrl(resolved.path, true)} download={resolved.name} className="my-2 flex max-w-full items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2 text-[13px] !text-fg !no-underline transition-colors hover:border-line-strong">
        <FileGlyph name={resolved.name} className="size-7" />
        <span className="min-w-0 flex-1 truncate font-medium">{resolved.name}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-fg-2">
          <Download className="size-3.5" /> Download
        </span>
      </a>
    );
  }
  if (state === 'ok' && resolved) return <FileCard card={resolved} />;
  return (
    <div className={cx('my-2.5 flex items-center gap-3 rounded-xl border border-dashed px-3.5 py-3', state === 'missing' ? 'border-danger/40' : 'border-line')}>
      <FileGlyph name={name} className="opacity-60" />
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium">{name}</div>
        <div className="text-[12px] text-fg-3">{state === 'missing' ? "This file wasn't saved. Ask to save it again and it will appear here as a download." : 'Looking for the file…'}</div>
      </div>
    </div>
  );
}

/** A workspace file the agent made or changed: live preview, view in full, download. */
export function FileCard({ card }: { card: FileCardData }) {
  const [meta, setMeta] = useState<(FileCardData & { text?: string; truncated?: boolean }) | null>(null);
  const [gone, setGone] = useState(false);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/files/meta?path=${encodeURIComponent(card.path)}`, { credentials: 'same-origin' });
    if (!res.ok) return setGone(true);
    setGone(false);
    setMeta(await res.json());
  };
  useEffect(() => {
    void load();
    return onServerEvent((ev) => {
      if (ev.type === 'workspace.file' && ev.path === card.path) {
        void load();
        setFlash(true);
        setTimeout(() => setFlash(false), 1600);
      }
    });
  }, [card.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = meta ?? card;
  const lines = meta?.text?.split('\n') ?? [];
  const isMd = /\.(md|markdown)$/i.test(m.name);
  const preview = lines.slice(0, 8).join('\n');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx('my-2.5 overflow-hidden rounded-xl border bg-panel transition-[border-color,box-shadow] duration-500', flash ? 'border-info/60 shadow-[0_0_0_3px_color-mix(in_oklab,var(--info)_18%,transparent)]' : 'border-line')}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <FileGlyph name={m.name} />
        <div className="min-w-0 flex-1">
          <button onClick={() => usePanel.getState().show('files', m.path)} className="block max-w-full truncate text-left text-[13.5px] font-medium hover:underline hover:decoration-line-strong hover:underline-offset-2" title="Open in the side panel">
            {m.name}
          </button>
          <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-fg-3">
            {gone ? <span className="text-danger">deleted</span> : <span className="shrink-0">{fmtBytes(m.size)}</span>}
            <span className="shrink-0">·</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={flash ? 'u' : m.updated} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={flash ? 'text-info' : undefined}>
                {flash ? 'updated' : `edited ${ago(m.updated)}`}
              </motion.span>
            </AnimatePresence>
            {m.path.replace(/^chats\/[^/]+\//, '') !== m.name && <span className="hidden min-w-0 truncate sm:inline">· {m.path.replace(/^chats\/[^/]+\//, '').split('/').slice(0, -1).join('/')}/</span>}
          </div>
        </div>
        {!gone && meta?.text !== undefined && <CopyButton text={() => meta?.text ?? ''} label="Copy contents" />}
        {!gone && (
          <a href={fileUrl(m.path, true)} download={m.name} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] text-fg-2 transition-colors hover:border-line-strong hover:text-fg">
            <Download className="size-3.5" /> <span className="hidden sm:inline">Download</span>
          </a>
        )}
      </div>

      {!gone && m.kind === 'image' && (
        <a href={fileUrl(m.path, false, m.updated)} target="_blank" rel="noreferrer" className="block border-t border-line bg-sunken">
          <img src={fileUrl(m.path, false, m.updated)} alt={m.name} className="mx-auto block max-h-[360px] w-auto object-contain" />
        </a>
      )}

      {!gone && m.kind === 'text' && meta?.text !== undefined && meta.text.length > 0 && (
        <div className="border-t border-line">
          {open ? (
            <div className="max-h-[520px] overflow-auto bg-sunken">
              {isMd ? <Markdown text={meta.text} className="px-4 py-3 !text-[13.5px]" /> : <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-[1.55] text-fg-2">{meta.text}</pre>}
              {meta.truncated && <div className="px-4 pb-3 text-[11.5px] text-fg-3">Preview cut off — download for the full file.</div>}
            </div>
          ) : (
            <pre className="relative max-h-[148px] overflow-hidden whitespace-pre-wrap break-words bg-sunken px-4 py-3 font-mono text-[12px] leading-[1.55] text-fg-2 [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">{preview}</pre>
          )}
          {(lines.length > 8 || isMd) && (
            <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-center gap-1 border-t border-line py-1.5 text-[12px] text-fg-3 transition-colors hover:bg-panel-2 hover:text-fg">
              {open ? 'Show less' : `View ${isMd ? 'document' : `all ${lines.length} lines`}`}
              <motion.span animate={{ rotate: open ? 180 : 0 }} className="inline-flex">
                <ChevronDown className="size-3.5" />
              </motion.span>
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

function Thumb({ src, site }: { src?: string; site: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="flex size-[68px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-contain p-1" />
      ) : (
        <span className="flex size-full items-center justify-center bg-panel-2 text-[18px] font-semibold uppercase text-fg-3">{site.slice(0, 1) || <Globe className="size-5" />}</span>
      )}
    </span>
  );
}

function LinkRow({ item }: { item: LinkItem }) {
  return (
    <div className="flex items-start gap-3.5 py-3">
      <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
        <Thumb src={item.image} site={item.site} />
      </a>
      <div className="min-w-0 flex-1">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[14px] font-medium leading-snug underline decoration-line-strong decoration-dotted underline-offset-[3px] hover:decoration-fg">
          {item.title}
        </a>
        {item.price && <div className="mt-1 text-[14px] font-semibold tabular-nums">{formatPrice(item.price)}</div>}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
          <span className="truncate">{item.site}</span>
          {item.note && (
            <>
              <span>·</span>
              <span className="truncate">{item.note}</span>
            </>
          )}
        </div>
        {!item.price && item.description && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">{item.description}</p>}
      </div>
    </div>
  );
}

/** "249.99 USD" → "$249.99" where the currency is known. */
function formatPrice(v: string) {
  const m = /^([\d.]+)\s*([A-Z]{3})?$/.exec(v.trim());
  if (!m) return v;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m[2] ?? 'USD' }).format(Number(m[1]));
  } catch {
    return v;
  }
}

export function LinksCard({ card }: { card: LinksCardData }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="my-2.5">
      {card.title && <div className="mb-0.5 text-[14px] font-semibold">{card.title}</div>}
      <div className="divide-y divide-line">
        {card.items.map((it, i) => (
          <LinkRow key={it.url + i} item={it} />
        ))}
      </div>
    </motion.div>
  );
}

export function ImagesCard({ card }: { card: ImagesCardData }) {
  const one = card.items.length === 1;
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cx('my-2.5 grid gap-2', one ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3')}>
      {card.items.map((im, i) => (
        <figure key={im.url + i} className="min-w-0">
          <a href={im.source ?? im.url} target="_blank" rel="noopener noreferrer" className={cx('block overflow-hidden rounded-lg border border-line bg-sunken', !one && 'aspect-square')}>
            <img src={im.url} alt={im.caption ?? ''} loading="lazy" referrerPolicy="no-referrer" className={cx('block', one ? 'mx-auto max-h-[380px] w-auto max-w-full object-contain' : 'size-full object-cover transition-transform hover:scale-[1.02]')} />
          </a>
          {(im.caption || im.site) && (
            <figcaption className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-fg-3">
              {im.caption && <span className="truncate text-fg-2">{im.caption}</span>}
              {im.caption && im.site && <span>·</span>}
              {im.site && (
                <a href={im.source ?? im.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 hover:text-fg">
                  {im.site} <ExternalLink className="size-3" />
                </a>
              )}
            </figcaption>
          )}
        </figure>
      ))}
    </motion.div>
  );
}

export function CardView({ card }: { card: AnyCard }) {
  if (card.type === 'file') return <FileCard card={card} />;
  if (card.type === 'links') return <LinksCard card={card} />;
  if (card.type === 'images') return <ImagesCard card={card} />;
  return <CommerceCardView card={card as CommerceCard} />;
}
