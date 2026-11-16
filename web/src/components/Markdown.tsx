import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '../lib/format';

export const Markdown = memo(function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  return (
    <div className={cx('prose-sable', streaming && 'streaming', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
