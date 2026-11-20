import { motion } from 'motion/react';
import { cx } from '../lib/format';

/** Sable's mark: a blocky S cut out of a rounded square, with a brass status notch. */
export function Logo({ size = 22, className, live, target }: { size?: number; className?: string; live?: boolean; target?: boolean }) {
  return (
    <span data-logo-target={target ? '' : undefined} className={cx('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <rect width="24" height="24" rx="6.5" fill="var(--fg)" />
        <path d="M7 6.5H17V9.9H14.5V9H9.5V10.75H17V17.5H7V14.1H9.5V15H14.5V13.25H7Z" fill="var(--bg)" />
      </svg>
      {live && (
        <motion.span
          className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-bg bg-accent"
          initial={{ scale: 0 }}
          animate={{ scale: [1, 1.25, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}
    </span>
  );
}
