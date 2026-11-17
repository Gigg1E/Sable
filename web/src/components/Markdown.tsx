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

export const Markdown = memo(function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  return (
    <div className={cx('prose-sable', streaming && 'streaming', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />, pre: Pre }}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
