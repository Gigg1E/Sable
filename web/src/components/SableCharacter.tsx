import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { cx } from '../lib/format';

/**
 * Sable's presence (docs/design/character.md). Deliberately minimal, two looks:
 *   orb   a dark sphere with an amber light inside and a ring around it (symbolic, no face)
 *   head  a marten's head silhouette: two round ears and two glowing amber eyes, nothing else
 *
 * Either way the mood reflects what Sable is really doing:
 *   idle      slow breath (head: the odd blink)
 *   thinking  a spark orbits (head: eyes look up)
 *   working   the ring spins in arcs (head: eyes narrow, small bob)
 *   waiting   the ring ripples outward: something needs your OK (head: ears up, eyes wide)
 *   happy     a little bounce (head: ^ ^ eyes)
 *   sleeping  dimmed, very slow breath (head: eyes closed)
 *   frozen    still, frost colored
 */
export type Mood = 'idle' | 'thinking' | 'working' | 'waiting' | 'happy' | 'sleeping' | 'frozen';
export type Look = 'orb' | 'head';

// The chosen look, shared by every instance and remembered on this device.
const LOOK_KEY = 'sable.look';
const subs = new Set<() => void>();
function readLook(): Look {
  try {
    return localStorage.getItem(LOOK_KEY) === 'head' ? 'head' : 'orb';
  } catch {
    return 'orb';
  }
}
let current: Look = readLook();
export function setLook(l: Look) {
  current = l;
  try {
    localStorage.setItem(LOOK_KEY, l);
  } catch {
    /* fine: just this session */
  }
  subs.forEach((f) => f());
}
export function useLook(): Look {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}

const loop = (duration: number, extra: Partial<Transition> = {}): Transition => ({ duration, repeat: Infinity, ease: 'easeInOut', ...extra });

/** An irregular, natural blink. */
function useBlink(active: boolean) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        setClosed(true);
        setTimeout(() => setClosed(false), 130);
        next();
      }, 2400 + Math.random() * 3600);
    };
    next();
    return () => clearTimeout(t);
  }, [active]);
  return closed;
}

type Props = {
  mood?: Mood;
  size?: number;
  look?: Look;
  className?: string;
  title?: string;
  /** Older call sites pass this; both looks are a single mark now. */
  variant?: 'full' | 'head';
};

// Transform origins are fractions of each shape's own box (motion uses fill-box for SVG).
export function SableCharacter({ mood = 'idle', size = 120, look, className, title }: Props) {
  const chosen = useLook();
  const which = look ?? chosen;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={cx('sable-char shrink-0 overflow-visible', mood === 'frozen' && 'sable-frozen', className)} role="img" aria-label={title ?? `Sable, ${mood}`}>
      {which === 'orb' ? <Orb mood={mood} /> : <Head mood={mood} />}
    </svg>
  );
}

/* ───────────── The orb ───────────── */

function Orb({ mood }: { mood: Mood }) {
  const reduce = useReducedMotion();
  const still = !!reduce || mood === 'frozen';
  const uid = useId().replace(/:/g, '');
  const light = mood === 'frozen' ? 'var(--sable-frost)' : 'var(--sable-bib)';
  const dim = mood === 'sleeping';

  return (
    <>
      <defs>
        <radialGradient id={`core-${uid}`} cx="50%" cy="58%" r="55%">
          <stop offset="0%" stopColor={light} stopOpacity={dim ? 0.3 : 0.95} />
          <stop offset="45%" stopColor={light} stopOpacity={dim ? 0.1 : 0.35} />
          <stop offset="100%" stopColor={light} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Waiting: ripples leave the ring, like a gentle knock. */}
      {mood === 'waiting' &&
        !still &&
        [0, 1].map((i) => (
          <motion.circle key={i} cx={50} cy={50} r={36} fill="none" stroke="var(--sable-bib)" strokeWidth={2.5} style={{ originX: 0.5, originY: 0.5 }} animate={{ scale: [1, 1.32], opacity: [0.7, 0] }} transition={loop(1.8, { delay: i * 0.9, ease: 'easeOut' })} />
        ))}

      {/* The ring: solid at rest, dotted while thinking, spinning arcs while working, faint asleep. */}
      <motion.g style={{ originX: 0.5, originY: 0.5 }} animate={{ rotate: mood === 'working' && !still ? 360 : 0 }} transition={mood === 'working' && !still ? loop(1.4, { ease: 'linear' }) : { duration: 0.4 }}>
        <motion.circle
          cx={50}
          cy={50}
          r={36}
          fill="none"
          stroke={mood === 'frozen' ? 'var(--sable-frost)' : 'var(--sable-bib)'}
          strokeWidth={3.2}
          strokeLinecap="round"
          animate={{ strokeDasharray: mood === 'working' ? '60 53' : mood === 'thinking' ? '2 9' : '226 0', opacity: dim ? 0.25 : mood === 'idle' ? 0.55 : 0.95 }}
          transition={{ duration: 0.5 }}
        />
      </motion.g>

      {/* The sphere and its inner light: breathes, bounces when happy. */}
      <motion.g
        style={{ originX: 0.5, originY: 1 }}
        animate={
          still
            ? { y: 0, scale: 1, scaleY: 1, scaleX: 1 }
            : mood === 'happy'
              ? { y: [0, -7, 0, 0], scaleY: [1, 1.04, 0.94, 1], scaleX: [1, 0.97, 1.05, 1] }
              : { scale: dim ? [1, 1.03, 1] : [1, 1.045, 1] }
        }
        transition={still ? { duration: 0.3 } : mood === 'happy' ? loop(1.3, { times: [0, 0.35, 0.6, 1] }) : loop(dim ? 4.5 : mood === 'working' ? 1.2 : 3.2)}
      >
        <circle cx={50} cy={50} r={25} fill="var(--sable-fur)" stroke="var(--sable-rim)" strokeWidth={1} />
        <circle cx={50} cy={50} r={25} fill={`url(#core-${uid})`} />
        <ellipse cx={42} cy={40} rx={7} ry={4.2} fill="var(--sable-sheen)" opacity={0.35} transform="rotate(-30 42 40)" />
      </motion.g>

      {/* Thinking: a spark circles the ring. */}
      <AnimatePresence>
        {mood === 'thinking' && !still && (
          <motion.g key="spark" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.circle cx={50} cy={14} r={4.6} fill="var(--sable-bib)" style={{ originX: '50px', originY: '50px', transformBox: 'view-box' }} animate={{ rotate: 360 }} transition={loop(1.6, { ease: 'linear' })} />
          </motion.g>
        )}
      </AnimatePresence>
    </>
  );
}

/* ───────────── The head ───────────── */

const HEAD = 'M50 30C69 30 82 42 82 59C82 76 68 86 50 86C32 86 18 76 18 59C18 42 31 30 50 30Z';

function Head({ mood }: { mood: Mood }) {
  const reduce = useReducedMotion();
  const still = !!reduce || mood === 'frozen';
  const blink = useBlink(!still && (mood === 'idle' || mood === 'waiting' || mood === 'thinking'));
  const eye = mood === 'frozen' ? 'var(--sable-frost)' : 'var(--sable-bib)';
  const earsUp = mood === 'waiting' || mood === 'happy';
  const gaze = mood === 'thinking' ? { x: 3, y: -4 } : { x: 0, y: 0 };
  const scaleY = blink ? 0.1 : mood === 'working' ? 0.4 : mood === 'waiting' ? 1.15 : 1;

  return (
    <motion.g
      style={{ originX: 0.5, originY: 1 }}
      animate={
        still
          ? { y: 0, rotate: 0, scaleY: 1 }
          : mood === 'happy'
            ? { y: [0, -6, 0, 0], rotate: 0 }
            : mood === 'working'
              ? { y: [0, 1.6, 0], rotate: 0 }
              : mood === 'sleeping'
                ? { y: 4, rotate: -6, scaleY: [1, 1.025, 1] }
                : mood === 'waiting'
                  ? { y: 0, rotate: 7 }
                  : { y: 0, rotate: 0, scaleY: [1, 1.02, 1] }
      }
      transition={
        still ? { duration: 0.3 } : mood === 'happy' ? loop(1.3, { times: [0, 0.35, 0.6, 1] }) : mood === 'working' ? loop(0.7) : mood === 'waiting' ? { type: 'spring', stiffness: 220, damping: 14 } : loop(mood === 'sleeping' ? 4.5 : 3.4)
      }
    >
      {/* Ears: round, set wide; they perk up when something needs you. */}
      {[27, 73].map((x, i) => (
        <motion.circle
          key={x}
          cx={x}
          cy={34}
          r={12}
          fill="var(--sable-fur)"
          stroke="var(--sable-rim)"
          strokeWidth={1}
          style={{ originX: 0.5, originY: 1 }}
          animate={earsUp ? { y: -4, rotate: i ? 10 : -10 } : { y: mood === 'sleeping' ? 3 : 0, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        />
      ))}
      <path d={HEAD} fill="var(--sable-fur)" stroke="var(--sable-rim)" strokeWidth={1} />

      {/* Eyes: two lights. They carry the whole expression. */}
      {[38, 62].map((x) =>
        mood === 'sleeping' ? (
          <path key={x} d={`M${x - 5} 60Q${x} 63.5 ${x + 5} 60`} stroke={eye} strokeOpacity={0.6} strokeWidth={3} strokeLinecap="round" fill="none" />
        ) : mood === 'happy' ? (
          <motion.path key={x} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} d={`M${x - 5.5} 61Q${x} 54 ${x + 5.5} 61`} stroke={eye} strokeWidth={3.4} strokeLinecap="round" fill="none" />
        ) : (
          <motion.ellipse key={x} cx={x} cy={58} rx={5} ry={6} fill={eye} style={{ originX: 0.5, originY: 0.5 }} animate={{ x: gaze.x, y: gaze.y, scaleY }} transition={{ duration: blink ? 0.06 : 0.22 }} />
        ),
      )}
    </motion.g>
  );
}
