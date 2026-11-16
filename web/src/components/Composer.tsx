import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Cpu, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/format';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';

const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export function Composer({ onSend, onStop, running, autoFocus, placeholder }: { onSend: (text: string) => Promise<void> | void; onStop?: () => void; running?: boolean; autoFocus?: boolean; placeholder?: string }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const settings = useStore((s) => s.settings);
  const provider = settings?.providers.find((p) => p.id === settings.main.providerId);
  const model = settings?.main.model || 'auto';

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [text]);

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
    <motion.div layout className="relative rounded-[22px] bg-surface border border-line shadow-soft focus-within:border-line-strong transition-colors">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder ?? `Ask ${settings?.persona.name ?? 'Sable'} to do something…`}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-subtle"
      />
      <div className="flex items-center justify-between px-2.5 pb-2.5">
        <button onClick={() => navigate('/settings/models')} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-subtle hover:text-fg hover:bg-surface-2 transition-colors max-w-[60%]">
          <Cpu className="size-3.5 shrink-0" />
          <span className="truncate">
            {model} · {provider?.name ?? '—'}
          </span>
        </button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => (running ? onStop?.() : void send())}
          aria-label={running ? 'Stop' : 'Send'}
          className={cx(
            'flex size-9 items-center justify-center rounded-full transition-colors',
            running ? 'bg-surface-3 text-fg' : text.trim() ? 'bg-fg text-bg' : 'bg-surface-2 text-subtle',
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={running ? 'stop' : 'send'} initial={{ scale: 0.5, opacity: 0, rotate: -45 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.5, opacity: 0, rotate: 45 }} transition={{ duration: 0.15 }}>
              {running ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4.5" />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </motion.div>
  );
}
