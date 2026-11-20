import { motion, type TargetAndTransition } from 'motion/react';
import { AlarmClock, AtSign, Bell, Bot, CalendarClock, Eye, MessageSquare, ShieldAlert, Webhook, type LucideIcon } from 'lucide-react';
import { cx } from '../lib/format';

/**
 * Visual signatures (docs/design/look-and-feel.md): every kind of event has the same icon, color
 * and one small motion wherever it appears, so you know what it is before reading it.
 */
interface Sig {
  icon: LucideIcon;
  color: string;
  label: string;
  /** One small, meaningful motion when it first appears. */
  enter: TargetAndTransition;
}

const SIGS: Record<string, Sig> = {
  approval: { icon: ShieldAlert, color: 'var(--accent)', label: 'Needs your OK', enter: { scale: [0.6, 1.08, 1], transition: { duration: 0.42 } } },
  reminder: { icon: AlarmClock, color: 'var(--tint)', label: 'Reminder', enter: { rotate: [0, -14, 12, -6, 0], transition: { duration: 0.6 } } },
  schedule: { icon: CalendarClock, color: 'var(--tint)', label: 'Routine', enter: { y: [-4, 0], opacity: [0, 1], transition: { duration: 0.3 } } },
  watch: { icon: Eye, color: 'var(--ok)', label: 'Watcher', enter: { scale: [0.7, 1], opacity: [0, 1], transition: { duration: 0.32 } } },
  mail: { icon: AtSign, color: 'var(--info)', label: 'Email', enter: { y: [-4, 0], opacity: [0, 1], transition: { duration: 0.3 } } },
  hook: { icon: Webhook, color: 'var(--info)', label: 'Webhook', enter: { x: [-5, 0], opacity: [0, 1], transition: { duration: 0.3 } } },
  agent: { icon: Bot, color: 'var(--fg-2)', label: 'Sable', enter: { y: [3, 0], opacity: [0, 1], transition: { duration: 0.3 } } },
  run: { icon: MessageSquare, color: 'var(--fg-2)', label: 'Task finished', enter: { y: [3, 0], opacity: [0, 1], transition: { duration: 0.3 } } },
  system: { icon: Bell, color: 'var(--fg-3)', label: 'Sable', enter: { opacity: [0, 1], transition: { duration: 0.3 } } },
};

export function signature(kind: string): Sig {
  return SIGS[kind] ?? SIGS.system;
}

/** The tile: tinted square with the kind's icon. `play` runs its little motion once. */
export function Signature({ kind, size = 32, play = true, className }: { kind: string; size?: number; play?: boolean; className?: string }) {
  const s = signature(kind);
  const Icon = s.icon;
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center rounded-[9px]', className)}
      style={{ width: size, height: size, color: s.color, background: `color-mix(in srgb, ${s.color} 13%, transparent)` }}
      title={s.label}
    >
      <motion.span className="flex" animate={play ? s.enter : undefined}>
        <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
      </motion.span>
    </span>
  );
}
