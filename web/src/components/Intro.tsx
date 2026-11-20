import { animate, motion, stagger, useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';

/**
 * The opening, about two seconds:
 *   1. a brass ring sweeps around while Sable's mark draws itself, a soft glow rising behind it;
 *   2. the mark fills with a small spring, the ring tightens and fades;
 *   3. the name rises in letter by letter, a brass line sweeps under it, a greeting fades in;
 *   4. desktop: the lockup flies onto the sidebar logo as the app fades in underneath.
 *      phone: the screen lifts like a curtain.
 *
 * Only opacity, transforms, pathLength and clip-path are animated (no CSS-variable colors), so it
 * behaves the same in Safari. A hard time limit means it can never get stuck. Once per session,
 * tap or any key skips it, and it never plays with "reduce motion".
 */

const KEY = 'sable.intro.seen';
const MARK = 44; // the sidebar mark is 22px, so the lockup lands at exactly 0.5 scale
const EASE = [0.2, 0.8, 0.2, 1] as const;
const FRAME = 'M6.5 0H17.5A6.5 6.5 0 0 1 24 6.5V17.5A6.5 6.5 0 0 1 17.5 24H6.5A6.5 6.5 0 0 1 0 17.5V6.5A6.5 6.5 0 0 1 6.5 0Z';
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

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Up late';
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
  const done = useRef(false);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      setShow(false);
    };
    // Never let a failed animation leave the overlay up.
    const hardStop = setTimeout(finish, 3500);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** Run an animation, but never throw: a browser quirk must not break the sequence. */
    const go = (sel: string, kf: Record<string, unknown>, opts: Record<string, unknown>) => {
      try {
        return Promise.resolve(run(sel, kf as never, opts as never)).catch(() => {});
      } catch {
        return Promise.resolve();
      }
    };

    (async () => {
      try {
        // 1. Glow, ring sweep, and the mark drawing itself.
        void go('[data-i=glow]', { opacity: [0, 1], scale: [0.6, 1] }, { duration: 0.9, ease: EASE });
        void go('[data-i=ring]', { pathLength: [0, 1], opacity: [0, 1] }, { duration: 0.75, ease: [0.65, 0, 0.35, 1] });
        void go('[data-i=frame-line]', { pathLength: [0, 1], opacity: [0, 1] }, { duration: 0.5, delay: 0.1, ease: EASE });
        await go('[data-i=s-line]', { pathLength: [0, 1], opacity: [0, 1] }, { duration: 0.5, delay: 0.28, ease: EASE });
        if (cancelled) return;

        // 2. Fill with a small spring; the ring tightens and fades; outlines hand over to solids.
        void go('[data-i=frame-fill]', { opacity: [0, 1], scale: [0.86, 1] }, { type: 'spring', stiffness: 380, damping: 18 });
        void go('[data-i=s-fill]', { opacity: [0, 1] }, { duration: 0.16, delay: 0.06 });
        void go('[data-i=frame-line]', { opacity: 0 }, { duration: 0.2 });
        void go('[data-i=s-line]', { opacity: 0 }, { duration: 0.2 });
        void go('[data-i=ring]', { scale: [1, 0.72], opacity: [1, 0] }, { duration: 0.4, ease: EASE });

        // 3. The name rises in letter by letter; a brass line sweeps under it; the greeting arrives.
        void go('[data-i=letter]', { y: ['105%', '0%'], opacity: [0, 1] }, { duration: 0.42, delay: stagger(0.045, { startDelay: 0.05 }), ease: EASE });
        await wait(380);
        if (cancelled) return;
        void go('[data-i=underline]', { scaleX: [0, 1] }, { duration: 0.42, ease: EASE });
        void go('[data-i=hello]', { opacity: [0, 1], y: [6, 0] }, { duration: 0.4, delay: 0.12, ease: EASE });
        await wait(620);
        if (cancelled) return;
        void go('[data-i=underline]', { scaleX: [1, 0], originX: [1, 1] }, { duration: 0.3, ease: EASE });

        // Let sign-in finish so we fly to the right place (bounded).
        for (let i = 0; i < 12 && authRef.current === 'loading' && !cancelled; i++) await wait(100);
        if (cancelled) return;
        await land();
      } finally {
        if (!cancelled) finish();
      }
    })();

    async function land() {
      void go('[data-i=hello]', { opacity: 0, y: -4 }, { duration: 0.2 });
      void go('[data-i=glow]', { opacity: 0, scale: 1.15 }, { duration: 0.5, ease: 'easeOut' });
      const target = [...document.querySelectorAll<HTMLElement>('[data-logo-target]')].find((el) => el.getBoundingClientRect().width > 0);
      const from = lockup.current?.querySelector('[data-i=mark]')?.getBoundingClientRect();
      try {
        if (target && from && lockup.current) {
          // 4a. Fly onto the sidebar's mark and name. Motion scales around the lockup's center.
          const to = target.getBoundingClientRect();
          const box = lockup.current.getBoundingClientRect();
          const scale = to.width / from.width;
          const cx = box.left + box.width / 2;
          const cy = box.top + box.height / 2;
          void go('[data-i=veil]', { opacity: 0 }, { duration: 0.45, delay: 0.08, ease: 'easeOut' });
          await animate(lockup.current, { x: to.left - (cx - (cx - from.left) * scale), y: to.top - (cy - (cy - from.top) * scale), scale }, { duration: 0.5, ease: EASE });
        } else {
          // 4b. Phones: the lockup lifts a little and the screen rises like a curtain.
          if (lockup.current) void animate(lockup.current, { y: -18, opacity: 0, scale: 0.96 }, { duration: 0.4, ease: EASE });
          await go('[data-i=veil]', { clipPath: ['inset(0% 0% 0% 0%)', 'inset(0% 0% 100% 0%)'] }, { duration: 0.6, delay: 0.1, ease: [0.7, 0, 0.2, 1] });
        }
      } catch {
        /* finish() runs regardless */
      }
    }

    const skip = () => {
      if (done.current) return;
      cancelled = true;
      try {
        void animate(scope.current, { opacity: 0 }, { duration: 0.18 }).then(finish, finish);
      } catch {
        finish();
      }
    };
    window.addEventListener('keydown', skip);
    return () => {
      cancelled = true;
      clearTimeout(hardStop);
      window.removeEventListener('keydown', skip);
    };
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;
  const letters = [...name];
  return (
    <div ref={scope} className="pointer-events-auto fixed inset-0 z-[100]" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown'))} aria-hidden>
      <div data-i="veil" className="absolute inset-0 bg-bg" style={{ clipPath: 'inset(0% 0% 0% 0%)' }} />
      <div className="absolute inset-0 flex items-center justify-center">
        {/* A soft brass glow behind the mark. */}
        <div
          data-i="glow"
          className="pointer-events-none absolute size-[520px] rounded-full"
          style={{ opacity: 0, background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent) 0%, color-mix(in srgb, var(--tint) 7%, transparent) 38%, transparent 68%)' }}
        />
        <div className="relative flex flex-col items-center">
          {/* Same proportions as the sidebar header (22px mark, 10px gap, 14px name) at 2x. */}
          <div ref={lockup} className="flex items-center gap-5">
            <svg data-i="mark" viewBox="0 0 24 24" width={MARK} height={MARK} className="overflow-visible">
              <motion.circle data-i="ring" cx="12" cy="12" r="18" fill="none" stroke="var(--accent)" strokeWidth={0.7} strokeLinecap="round" style={{ opacity: 0, rotate: -90, originX: '50%', originY: '50%' }} />
              <motion.path data-i="frame-fill" d={FRAME} fill="var(--fg)" style={{ opacity: 0, originX: '50%', originY: '50%' }} />
              <motion.path data-i="s-fill" d={S_PATH} fill="var(--bg)" style={{ opacity: 0 }} />
              <motion.path data-i="frame-line" d={FRAME} fill="none" stroke="var(--fg)" strokeWidth={1} style={{ opacity: 0 }} />
              <motion.path data-i="s-line" d={S_PATH} fill="none" stroke="var(--fg)" strokeWidth={0.9} strokeLinejoin="round" style={{ opacity: 0 }} />
            </svg>
            <span className="relative text-[28px] font-semibold tracking-[-0.01em] text-fg">
              <span className="flex overflow-hidden pb-1">
                {letters.map((ch, i) => (
                  <motion.span key={i} data-i="letter" className="inline-block whitespace-pre" style={{ opacity: 0 }}>
                    {ch}
                  </motion.span>
                ))}
              </span>
              <motion.span data-i="underline" className="absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full bg-accent" style={{ scaleX: 0, originX: 0 }} />
            </span>
          </div>
          <motion.span data-i="hello" className="absolute top-full mt-5 whitespace-nowrap text-[13px] text-fg-3" style={{ opacity: 0 }}>
            {greeting()}
          </motion.span>
        </div>
      </div>
    </div>
  );
}
