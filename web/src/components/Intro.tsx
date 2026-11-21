import { animate, motion, stagger, useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { Presence } from './Presence';
import { SableCharacter, type Mood } from './SableCharacter';

/**
 * The opening, about two and a half seconds: Sable rises over the horizon to say hello.
 *   1. a warm glow rises and an amber ground line draws itself out from the center;
 *   2. Sable rises from behind the line with a spring, then a happy bounce;
 *   3. its name rises letter by letter underneath, then a greeting;
 *   4. desktop: Sable shrinks and flies onto the sidebar, where it lives;
 *      phone: Sable ducks back down and the screen lifts like a curtain.
 *
 * Only opacity, transforms, pathLength and clip-path are animated, so Safari behaves. A hard time
 * limit means it can never get stuck. Once per session; tap or any key skips; never with reduce motion.
 */

const KEY = 'sable.intro.seen';
const SIZE = 132;
const EASE = [0.2, 0.8, 0.2, 1] as const;

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
  return h < 5 ? 'Up late? Me too.' : h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : h < 22 ? 'Good evening.' : 'Up late? Me too.';
}

export function Intro() {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(() => !reduced && shouldPlay());
  const [mood, setMood] = useState<Mood>('idle');
  const [scope, run] = useAnimate();
  const head = useRef<HTMLDivElement>(null);
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
    const hardStop = setTimeout(finish, 4200);
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
        // 1. Glow and the ground line.
        void go('[data-i=glow]', { opacity: [0, 1], scale: [0.6, 1] }, { duration: 0.9, ease: EASE });
        await go('[data-i=ground]', { scaleX: [0, 1], opacity: [0, 1] }, { duration: 0.45, ease: EASE });
        if (cancelled) return;

        // 2. Sable pops up from behind the line.
        await go('[data-i=sable]', { y: ['105%', '0%'] }, { type: 'spring', stiffness: 260, damping: 17 });
        if (cancelled) return;
        await wait(120);
        setMood('happy');

        // 3. The name, then the greeting.
        void go('[data-i=letter]', { y: ['105%', '0%'], opacity: [0, 1] }, { duration: 0.42, delay: stagger(0.05), ease: EASE });
        await wait(420);
        void go('[data-i=hello]', { opacity: [0, 1], y: [6, 0] }, { duration: 0.4, ease: EASE });
        await wait(650);
        if (cancelled) return;
        setMood('idle');

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
      void go('[data-i=name]', { opacity: 0, y: 6 }, { duration: 0.25 });
      void go('[data-i=ground]', { scaleX: 0, opacity: 0 }, { duration: 0.35, ease: EASE });
      void go('[data-i=glow]', { opacity: 0, scale: 1.15 }, { duration: 0.5, ease: 'easeOut' });
      const target = [...document.querySelectorAll<HTMLElement>('[data-logo-target]')].find((el) => el.getBoundingClientRect().width > 0);
      try {
        if (target && head.current) {
          // 4a. Swap to the copy outside the clip and fly it onto the sidebar.
          void go('[data-i=full]', { opacity: 0 }, { duration: 0.12 });
          void go('[data-i=head]', { opacity: 1 }, { duration: 0.08 });
          // On the way, the matrix dissolves into the outline head that lives in the sidebar.
          void go('[data-i=hp]', { opacity: 0 }, { duration: 0.4, delay: 0.1 });
          void go('[data-i=hh]', { opacity: 1 }, { duration: 0.4, delay: 0.1 });
          const to = target.getBoundingClientRect();
          const from = head.current.getBoundingClientRect();
          const scale = to.width / from.width;
          // Motion scales around the element's center.
          const dx = to.left + to.width / 2 - (from.left + from.width / 2);
          const dy = to.top + to.height / 2 - (from.top + from.height / 2);
          void go('[data-i=veil]', { opacity: 0 }, { duration: 0.45, delay: 0.12, ease: 'easeOut' });
          await animate(head.current, { x: dx, y: dy, scale }, { duration: 0.55, ease: [0.5, 0, 0.2, 1] });
        } else {
          // 4b. Phones: Sable ducks back down and the screen rises like a curtain.
          void go('[data-i=sable]', { y: '105%' }, { duration: 0.3, ease: [0.5, 0, 0.75, 0] });
          await go('[data-i=veil]', { clipPath: ['inset(0% 0% 0% 0%)', 'inset(0% 0% 100% 0%)'] }, { duration: 0.6, delay: 0.2, ease: [0.7, 0, 0.2, 1] });
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
  return (
    <div ref={scope} className="pointer-events-auto fixed inset-0 z-[100]" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown'))} aria-hidden>
      <div data-i="veil" className="absolute inset-0 bg-bg" style={{ clipPath: 'inset(0% 0% 0% 0%)' }} />
      <div className="absolute inset-0 flex items-center justify-center">
        <div data-i="glow" className="pointer-events-none absolute" style={{ opacity: 0 }} />
        <div className="relative flex flex-col items-center">
          {/* Sable, clipped at the ground line so it comes up out of the den. */}
          <div className="relative overflow-hidden pt-6" style={{ width: SIZE + 48, height: SIZE + 24 }}>
            <div data-i="sable" className="absolute bottom-0 left-6" style={{ transform: 'translateY(105%)' }}>
              <div data-i="full">
                <Presence mood={mood} size={SIZE} />
              </div>
            </div>
          </div>
          {/* The same mark laid exactly over it, outside the clip, for the flight to the sidebar. */}
          <div ref={head} data-i="head" className="absolute" style={{ width: SIZE, height: SIZE, left: 24, top: 24, opacity: 0 }}>
            <div data-i="hp" className="absolute inset-0">
              <Presence mood="idle" size={SIZE} />
            </div>
            <div data-i="hh" className="absolute inset-0 text-fg" style={{ opacity: 0 }}>
              <SableCharacter mood="idle" size={SIZE} />
            </div>
          </div>
          <div data-i="ground" className="h-[2px] rounded-full bg-accent" style={{ width: SIZE + 48, opacity: 0, transform: "scaleX(0)" }} />
          <div data-i="name" className="voice mt-5 flex overflow-hidden pb-1 text-[36px] font-bold leading-none text-fg">
            {[...name].map((ch, i) => (
              <motion.span key={i} data-i="letter" className="inline-block whitespace-pre" style={{ opacity: 0 }}>
                {ch}
              </motion.span>
            ))}
          </div>
          <motion.span data-i="hello" className="mt-2 whitespace-nowrap text-[14px] text-fg-2" style={{ opacity: 0 }}>
            {greeting()}
          </motion.span>
        </div>
      </div>
    </div>
  );
}
