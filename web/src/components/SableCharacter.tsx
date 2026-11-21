import { motion, useReducedMotion, type Transition } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { cx } from '../lib/format';

/**
 * Sable's mark (docs/design/character.md): a head drawn as one outline, two round ears,
 * and two amber eyes that carry every expression. No fills, no shading, no detail.
 *
 *   idle      slow breath, the odd blink
 *   thinking  eyes look up and aside
 *   working   eyes narrow, small bob
 *   waiting   ears up, head tilts, eyes wide: something needs your OK
 *   happy     ^ ^ eyes and a hop
 *   sleeping  eyes closed, head lowered, slow breath
 *   frozen    still, frost-blue eyes
 */
export type Mood = 'idle' | 'thinking' | 'working' | 'waiting' | 'happy' | 'sleeping' | 'frozen';

const loop = (duration: number, extra: Partial<Transition> = {}): Transition => ({ duration, repeat: Infinity, ease: 'easeInOut', ...extra });

const HEAD = 'M50 31C68 31 81 43 81 60C81 76 67 86 50 86C33 86 19 76 19 60C19 43 32 31 50 31Z';
const EARS = [
  { x: 28, y: 35 },
  { x: 72, y: 35 },
];

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
  className?: string;
  title?: string;
  /** Older call sites pass this; there is one mark now. */
  variant?: 'full' | 'head';
};

// Transform origins are fractions of each shape's own box (motion uses fill-box for SVG).
export function SableCharacter({ mood = 'idle', size = 120, className, title }: Props) {
  const reduce = useReducedMotion();
  const still = !!reduce || mood === 'frozen';
  const blink = useBlink(!still && (mood === 'idle' || mood === 'waiting' || mood === 'thinking'));
  const uid = useId().replace(/:/g, '');
  // About 1.5px on screen when small, up to about 3px when large.
  const line = Math.min(7, Math.max(2.6, 160 / size));
  const eye = mood === 'frozen' ? 'var(--sable-frost)' : 'var(--accent)';
  const earsUp = mood === 'waiting' || mood === 'happy';
  const gaze = mood === 'thinking' ? { x: 4, y: -5 } : { x: 0, y: 0 };
  const scaleY = blink ? 0.12 : mood === 'working' ? 0.35 : mood === 'waiting' ? 1.2 : 1;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={cx('sable-char shrink-0 overflow-visible', className)} role="img" aria-label={title ?? `Sable, ${mood}`}>
      <defs>
        {/* The ears are circles; the head hides the part of them inside it, so the outline reads as one shape. */}
        <mask id={`ears-${uid}`} maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140">
          <rect x="-20" y="-20" width="140" height="140" fill="white" />
          <path d={HEAD} fill="black" />
        </mask>
      </defs>
      <motion.g
        style={{ originX: 0.5, originY: 1 }}
        animate={
          still
            ? { y: 0, rotate: 0, scaleY: 1 }
            : mood === 'happy'
              ? { y: [0, -7, 0, 0], rotate: 0 }
              : mood === 'working'
                ? { y: [0, 1.8, 0], rotate: 0 }
                : mood === 'sleeping'
                  ? { y: 4, rotate: -6, scaleY: [1, 1.025, 1] }
                  : mood === 'waiting'
                    ? { y: 0, rotate: 7 }
                    : { y: 0, rotate: 0, scaleY: [1, 1.02, 1] }
        }
        transition={
          still ? { duration: 0.3 } : mood === 'happy' ? loop(1.3, { times: [0, 0.35, 0.6, 1] }) : mood === 'working' ? loop(0.7) : mood === 'waiting' ? { type: 'spring', stiffness: 220, damping: 14 } : loop(mood === 'sleeping' ? 4.5 : 3.4)
        }
        fill="none"
        stroke="currentColor"
        strokeWidth={line}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g mask={`url(#ears-${uid})`}>
          {EARS.map((e, i) => (
            <motion.circle
              key={e.x}
              cx={e.x}
              cy={e.y}
              r={12}
              style={{ originX: 0.5, originY: 1 }}
              animate={earsUp ? { y: -4, rotate: i ? 12 : -12 } : { y: mood === 'sleeping' ? 3 : 0, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 14 }}
            />
          ))}
        </g>
        <path d={HEAD} />

        {/* Eyes: the only color, and the whole expression. */}
        {[39, 61].map((x) =>
          mood === 'sleeping' ? (
            <path key={x} d={`M${x - 5} 60Q${x} 64 ${x + 5} 60`} stroke={eye} strokeOpacity={0.7} strokeWidth={line * 0.8} />
          ) : mood === 'happy' ? (
            <motion.path key={x} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} d={`M${x - 5.5} 62Q${x} 54 ${x + 5.5} 62`} stroke={eye} strokeWidth={line * 0.9} />
          ) : (
            <motion.ellipse key={x} cx={x} cy={59} rx={4.4} ry={5.4} fill={eye} stroke="none" style={{ originX: 0.5, originY: 0.5 }} animate={{ x: gaze.x, y: gaze.y, scaleY }} transition={{ duration: blink ? 0.06 : 0.22 }} />
          ),
        )}
      </motion.g>
    </svg>
  );
}
