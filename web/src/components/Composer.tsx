import { ArrowUp, Square } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cx } from '../lib/format';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { Kbd, Tip } from './ui';

const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export interface ComposerHandle {
  setText: (t: string) => void;
  focus: () => void;
}

export const Composer = forwardRef<ComposerHandle, { onSend: (text: string) => Promise<void> | void; onStop?: () => void; running?: boolean; autoFocus?: boolean; placeholder?: string; minRows?: number }>(
  function Composer({ onSend, onStop, running, autoFocus, placeholder, minRows = 1 }, handle) {
    const [text, setText] = useState('');
    const ref = useRef<HTMLTextAreaElement>(null);
    const settings = useStore((s) => s.settings);
    const provider = settings?.providers.find((p) => p.id === settings.main.providerId);

    useImperativeHandle(handle, () => ({
      setText: (t) => {
        setText(t);
        requestAnimationFrame(() => {
          ref.current?.focus();
          ref.current?.setSelectionRange(t.length, t.length);
        });
      },
      focus: () => ref.current?.focus(),
    }));

    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      el.style.height = '0px';
      el.style.height = Math.min(Math.max(el.scrollHeight, minRows * 24 + 20), 260) + 'px';
    }, [text, minRows]);
    useEffect(() => {
      if (autoFocus && !coarse) ref.current?.focus();
    }, [autoFocus]);

    async function send() {
      const t = text.trim();
      if (!t || running) return;
      setText('');
      await onSend(t);
    }

    return (
      <div className="rounded-xl border border-line bg-panel shadow-2 transition-colors focus-within:border-line-strong">
        <textarea
          ref={ref}
          value={text}
          rows={minRows}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder ?? `Describe a task for ${settings?.persona.name ?? 'Sable'}…`}
          className="block w-full resize-none bg-transparent px-3.5 pt-3 text-[14.5px] leading-6 outline-none placeholder:text-fg-3"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          <Tip label="Change model">
            <button onClick={() => navigate('/settings/models')} className="flex h-6 max-w-[55%] items-center gap-1.5 rounded-md border border-line px-2 font-mono text-[11px] text-fg-3 transition-colors hover:border-line-strong hover:text-fg-2">
              <span className="size-1.5 shrink-0 rounded-full bg-ok" />
              <span className="truncate">{settings?.main.model || 'auto'}</span>
              <span className="hidden text-fg-3/70 sm:inline">· {provider?.name}</span>
            </button>
          </Tip>
          <span className="flex-1" />
          {!coarse && !running && (
            <span className="hidden items-center gap-1 text-[11px] text-fg-3 sm:flex">
              <Kbd>↵</Kbd> send <Kbd className="ml-1">⇧↵</Kbd> new line
            </span>
          )}
          <button
            onClick={() => (running ? onStop?.() : void send())}
            aria-label={running ? 'Stop' : 'Send'}
            className={cx(
              'flex size-7 items-center justify-center rounded-md transition-all active:scale-95',
              running ? 'border border-line-strong bg-panel-2 text-fg hover:bg-panel-3' : text.trim() ? 'bg-fg text-bg' : 'bg-panel-3 text-fg-3',
            )}
          >
            {running ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" strokeWidth={2.2} />}
          </button>
        </div>
      </div>
    );
  },
);
