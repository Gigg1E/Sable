import { memo, useRef, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '../lib/format';
import { CopyButton } from './ui';

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

export const Markdown = memo(function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  return (
    <div className={cx('prose-sable', streaming && 'streaming', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: A, pre: Pre }}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
