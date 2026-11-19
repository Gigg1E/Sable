import { memo, useRef, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { normalizeMath } from '../lib/mathText';
import { cx } from '../lib/format';
import { CopyButton } from './ui';
import { FileRef } from './Cards';

const FILE_HREF = '#sable-file=';
/**
 * Models sometimes "attach" a file with a link like ![Report.txt](file:Report final.txt) or a
 * sandbox:/ path. Those aren't real URLs (and spaces stop Markdown from parsing them at all), so
 * turn them into internal file references that render as file cards.
 */
function fileLinks(text: string) {
  return text.replace(/!?\[([^\]\n]*)\]\(\s*<?((?:file|sandbox|attachment):[^)>\n]+?)>?\s*\)/gi, (_m, label: string, target: string) => `[${label.replace(/[[\]]/g, '')}](${FILE_HREF}${encodeURIComponent(target.trim())})`);
}
const isFileHref = (h: unknown) => typeof h === 'string' && h.startsWith(FILE_HREF);
const filePath = (h: string) => decodeURIComponent(h.slice(FILE_HREF.length));

/** Code block with its language and a copy button. */
function Pre({ node: _n, children, ...props }: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  const code = (children as { props?: { className?: string } } | undefined)?.props?.className ?? '';
  const lang = /language-([\w+#.-]+)/.exec(code)?.[1];
  return (
    <div className="code-block group/code relative">
      <div className="absolute right-1.5 top-1.5 z-[1] flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/code:opacity-100 sm:focus-within:opacity-100">
        {lang && <span className="font-mono text-[10.5px] text-fg-3">{lang}</span>}
        <CopyButton text={() => ref.current?.innerText.replace(/\n$/, '') ?? ''} label="Copy code" className="bg-sunken" />
      </div>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}

/** A link whose text is just a site name ("tomshardware.com"), a number or the URL itself reads best as a small source chip. */
function A({ node: _n, children, href, ...props }: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  if (isFileHref(href)) return <FileRef path={filePath(href!)} inline />;
  const text = typeof children === 'string' ? children : Array.isArray(children) && children.every((c) => typeof c === 'string') ? children.join('') : null;
  let host = '';
  try {
    host = new URL(href ?? '').hostname.replace(/^www\./, '');
  } catch {
    /* relative or invalid */
  }
  const chip = !!host && text !== null && (text === href || /^\[?\d{1,2}\]?$/.test(text) || (/^[\w-]+(\.[\w-]+)+$/.test(text) && text.length <= 40));
  if (chip) {
    const label = /^\[?\d/.test(text!) || text === href ? host : text!.replace(/^www\./, '');
    return (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="source-chip" title={href}>
        <span className="source-chip-dot">{label.slice(0, 1)}</span>
        <span className="truncate">{label}</span>
      </a>
    );
  }
  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

type HastNode = { type: string; tagName?: string; value?: string; properties?: { href?: unknown }; children?: HastNode[] };
/** A paragraph that is only a file reference becomes the full file card (a card can't sit inside <p>). */
function P({ node, children, ...props }: ComponentPropsWithoutRef<'p'> & { node?: HastNode }) {
  const kids = (node?.children ?? []).filter((c) => !(c.type === 'text' && !c.value?.trim()));
  const only = kids.length === 1 && kids[0].tagName === 'a' && isFileHref(kids[0].properties?.href) ? kids[0] : null;
  if (only) return <FileRef path={filePath(String(only.properties!.href))} />;
  return <p {...props}>{children}</p>;
}

export const Markdown = memo(function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  return (
    <div className={cx('prose-sable', streaming && 'streaming', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]} components={{ a: A, pre: Pre, p: P }}>
        {normalizeMath(fileLinks(text))}
      </ReactMarkdown>
    </div>
  );
});

/**
 * Split streamed Markdown into finished blocks (separated by blank lines, never inside a code
 * fence) and the block still being written. Finished blocks are memoized, so each update only
 * re-parses the last paragraph instead of the whole reply.
 */
function splitBlocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && !line.trim() && cur.length) {
      out.push(cur.join('\n'));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

export function StreamingMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = splitBlocks(text);
  // Lists and tables span blank lines less often than paragraphs; merging consecutive list items
  // keeps numbering right in most replies.
  const merged: string[] = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && /^\s*([-*+]|\d+[.)])\s/.test(b) && /^\s*([-*+]|\d+[.)])\s/m.test(prev)) merged[merged.length - 1] = prev + '\n\n' + b;
    else merged.push(b);
  }
  return (
    <div className={cx('streaming', className)}>
      {merged.map((b, i) => (i === merged.length - 1 ? <Markdown key={`live-${i}`} text={b} /> : <Markdown key={`b-${i}`} text={b} />))}
    </div>
  );
}
