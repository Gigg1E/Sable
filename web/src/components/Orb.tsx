import { motion } from 'motion/react';
import { cx } from '../lib/format';

export type OrbState = 'idle' | 'working' | 'waiting';

/** Sable's presence: a soft living gradient that breathes when idle and swirls while it works. */
export function Orb({ size = 28, state = 'idle', className }: { size?: number; state?: OrbState; className?: string }) {
  const speed = state === 'working' ? 2.4 : state === 'waiting' ? 5 : 9;
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            state === 'waiting'
              ? 'radial-gradient(circle at 35% 30%, #ffe2b8, #ffb36b 45%, #e5853b 80%)'
              : 'radial-gradient(circle at 35% 30%, #ffd9ae, #c793ff 45%, #5b35e0 85%)',
          filter: `blur(${size / 5}px)`,
        }}
        animate={{ scale: state === 'idle' ? [0.85, 1, 0.85] : [0.9, 1.15, 0.9], opacity: [0.55, 0.85, 0.55] }}
        transition={{ duration: state === 'working' ? 1.6 : 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute inset-[8%] rounded-full overflow-hidden"
        animate={{ rotate: 360 }}
        transition={{ duration: speed, repeat: Infinity, ease: 'linear' }}
        style={{
          background:
            state === 'waiting'
              ? 'conic-gradient(from 0deg, #ffcf8f, #ff9f5a, #ffe0b5, #ffb874, #ffcf8f)'
              : 'conic-gradient(from 0deg, #b28cff, #ffb874, #8f6bff, #ffd2a6, #6b45ea, #b28cff)',
        }}
      >
        <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.75), transparent 45%)' }} />
      </motion.div>
    </div>
  );
}
