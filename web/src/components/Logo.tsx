import { cx } from '../lib/format';
import { SableCharacter, type Mood } from './SableCharacter';

/** Sable's mark is Sable itself: the marten's head, in whatever mood it's in. */
export function Logo({ size = 22, className, mood = 'idle', target }: { size?: number; className?: string; mood?: Mood; target?: boolean }) {
  return (
    <span data-logo-target={target ? '' : undefined} className={cx('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      <SableCharacter variant="head" mood={mood} size={size} />
    </span>
  );
}
