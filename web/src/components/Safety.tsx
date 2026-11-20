import { AnimatePresence, motion } from 'motion/react';
import { Snowflake } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import { onServerEvent, useStore } from '../lib/store';

/** Whether Sable is frozen (observe only), kept live. */
export function useFrozen() {
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    void api.get<{ frozen: boolean }>('/safety').then((r) => setFrozen(r.frozen)).catch(() => {});
    return onServerEvent((ev) => ev.type === 'safety.changed' && setFrozen(!!ev.frozen));
  }, []);
  const toast = useStore((s) => s.toast);
  const set = useCallback(
    async (on: boolean) => {
      try {
        const r = await api.post<{ frozen: boolean; denied: number }>('/safety/freeze', { frozen: on });
        setFrozen(r.frozen);
        toast({ title: on ? 'Sable is frozen' : 'Sable is acting again', body: on ? `It can look but not act.${r.denied ? ` Denied ${r.denied} waiting request${r.denied > 1 ? 's' : ''}.` : ''}` : undefined, tone: on ? 'default' : 'success' });
      } catch (err) {
        toast({ title: 'Could not change that', body: (err as Error).message, tone: 'error' });
      }
    },
    [toast],
  );
  return { frozen, set };
}

/** Across the top of every page while frozen: what it means, and the way out. */
export function FrozenBanner() {
  const { frozen, set } = useFrozen();
  return (
    <AnimatePresence initial={false}>
      {frozen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="shrink-0 overflow-hidden border-b border-tint/25 bg-tint-soft"
        >
          <div className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <motion.span initial={{ rotate: -90, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="text-tint">
              <Snowflake className="size-4" />
            </motion.span>
            <span className="min-w-0 flex-1 text-fg-2">
              <b className="font-medium text-fg">Frozen.</b> Sable can look things up but won't change, send or buy anything until you unfreeze it.
            </span>
            <button onClick={() => void set(false)} className="h-7 shrink-0 rounded-md border border-line bg-panel px-2.5 text-[12.5px] font-medium hover:bg-panel-2">
              Unfreeze
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The status bar's freeze switch. */
export function FreezeButton({ className }: { className?: string }) {
  const { frozen, set } = useFrozen();
  return (
    <button
      onClick={() => void set(!frozen)}
      title={frozen ? 'Unfreeze: let Sable act again' : 'Freeze: Sable stops acting and only looks. Also: send /freeze in any chat'}
      className={cx('flex items-center gap-1.5 hover:text-fg-2', frozen && 'text-tint', className)}
    >
      <Snowflake className="size-3" /> {frozen ? 'frozen' : 'freeze'}
    </button>
  );
}
