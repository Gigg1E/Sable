import { animate, motion, useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';

/**
 * The opening: Sable's mark draws itself, fills, the wordmark settles in beside it, and then the
 * whole thing flies into its place in the sidebar while the app fades in underneath. So the intro
 * becomes the app instead of being a splash screen in front of it.
 *
 * Once per browser session, skippable with a click or key, never with "reduce motion".
 */

const KEY = 'sable.intro.seen';
const MARK = 44; // px; the sidebar mark is 22, so the whole lockup flies at exactly 0.5 scale
const EASE = [0.2, 0.8, 0.2, 1] as const;
const S_PATH = 'M7 6.5H17V9.9H14.5V9H9.5V10.75H17V17.5H7V14.1H9.5V15H14.5V13.25H7Z';

function shouldPlay() {
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: play it, it's short */
  }
  return true;
}

export function Intro() {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(() => !reduced && shouldPlay());
  const [scope, run] = useAnimate();
  const lockup = useRef<HTMLDivElement>(null);
  const name = useStore((s) => s.settings?.persona.name ?? 'Sable');
  const auth = useStore((s) => s.auth);
  const authRef = useRef(auth);
  authRef.current = auth;
  const skipped = useRef(false);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      // 1. Draw: the rounded square, then the S, as strokes.
      await Promise.all([
        run('[data-i=frame]', { pathLength: [0, 1], opacity: [0, 1] }, { duration: 0.46, ease: EASE }),
        run('[data-i=s]', { pathLength: [0, 1], opacity: [0, 1] }, { duration: 0.42, delay: 0.14, ease: EASE }),
      ]);
      if (cancelled) return;
      // 2. Fill: the square goes solid and the S is cut out of it. The wordmark settles in.
      void run('[data-i=frame]', { fill: 'var(--fg)' } as never, { duration: 0.18 });
      void run('[data-i=s]', { fill: 'var(--bg)', stroke: 'var(--bg)' } as never, { duration: 0.18 });
      void run('[data-i=word]', { opacity: [0, 1], letterSpacing: ['0.32em', '-0.01em'], x: [-6, 0] }, { duration: 0.42, ease: EASE });
      await wait(520);
      // The app may still be signing in; give it a moment so we fly to the right place.
      for (let i = 0; i < 15 && authRef.current === 'loading' && !cancelled; i++) await wait(100);
      if (cancelled) return;
      await land();
    })();

    async function land() {
      const target = [...document.querySelectorAll<HTMLElement>('[data-logo-target]')].find((el) => el.getBoundingClientRect().width > 0);
      const from = lockup.current?.querySelector('svg')?.getBoundingClientRect();
      const veil = run('[data-i=veil]', { opacity: 0 }, { duration: 0.42, ease: 'easeOut' });
      if (target && from && lockup.current) {
        // 3. Fly: the lockup lands exactly on the sidebar's mark and name. Motion scales around the
        // lockup's center, so work out where the mark ends up from there.
        const to = target.getBoundingClientRect();
        const box = lockup.current.getBoundingClientRect();
        const scale = to.width / from.width;
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const x = to.left - (cx - (cx - from.left) * scale);
        const y = to.top - (cy - (cy - from.top) * scale);
        await animate(lockup.current, { x, y, scale }, { duration: 0.46, ease: EASE });
      } else if (lockup.current) {
        await animate(lockup.current, { opacity: 0, scale: 0.92 }, { duration: 0.32, ease: 'easeOut' });
      }
      await veil;
      setShow(false);
    }

    const skip = () => {
      if (skipped.current) return;
      skipped.current = true;
      cancelled = true;
      void animate(scope.current, { opacity: 0 }, { duration: 0.18 }).then(() => setShow(false));
    };
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', skip);
    };
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;
  return (
    <div
      ref={scope}
      className="pointer-events-auto fixed inset-0 z-[100]"
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown'))}
      aria-hidden
    >
      <div data-i="veil" className="absolute inset-0 bg-bg" />
      <div className="absolute inset-0 flex items-center justify-center">
        {/* Same proportions as the sidebar header (22px mark, 10px gap, 14px name) at 2x. */}
        <div ref={lockup} className="flex items-center gap-5">
          <svg viewBox="0 0 24 24" width={MARK} height={MARK} className="overflow-visible">
            <motion.path
              data-i="frame"
              d="M6.5 0H17.5A6.5 6.5 0 0 1 24 6.5V17.5A6.5 6.5 0 0 1 17.5 24H6.5A6.5 6.5 0 0 1 0 17.5V6.5A6.5 6.5 0 0 1 6.5 0Z"
              fill="rgba(0,0,0,0)"
              stroke="var(--fg)"
              strokeWidth={1}
              style={{ opacity: 0 }}
            />
            <motion.path data-i="s" d={S_PATH} fill="rgba(0,0,0,0)" stroke="var(--fg)" strokeWidth={0.9} strokeLinejoin="round" style={{ opacity: 0 }} />
          </svg>
          <motion.span data-i="word" className="text-[28px] font-semibold tracking-[-0.01em] text-fg" style={{ opacity: 0 }}>
            {name}
          </motion.span>
        </div>
      </div>
    </div>
  );
}
