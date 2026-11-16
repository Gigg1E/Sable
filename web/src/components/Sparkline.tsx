import { motion } from 'motion/react';
import { useId } from 'react';

/** Minimal step chart for a watcher's numeric history (oldest → newest). */
export function Sparkline({ points, width = 120, height = 32, className }: { points: { ts: number; numeric: number | null; triggered?: number }[]; width?: number; height?: number; className?: string }) {
  const gid = useId();
  const pts = points.filter((p) => p.numeric != null) as { ts: number; numeric: number; triggered?: number }[];
  if (pts.length < 2) return <svg width={width} height={height} className={className} />;
  const min = Math.min(...pts.map((p) => p.numeric));
  const max = Math.max(...pts.map((p) => p.numeric));
  const t0 = pts[0].ts;
  const t1 = Math.max(pts[pts.length - 1].ts, Date.now());
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (width - 4) + 2;
  const y = (v: number) => (max === min ? height / 2 : height - 3 - ((v - min) / (max - min)) * (height - 6));
  // Step line: a price holds until it changes.
  let d = `M ${x(pts[0].ts)} ${y(pts[0].numeric)}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${x(pts[i].ts)} V ${y(pts[i].numeric)}`;
  d += ` H ${x(t1)}`;
  const last = pts[pts.length - 1];
  const up = last.numeric > pts[0].numeric;
  const color = up ? 'var(--danger)' : last.numeric < pts[0].numeric ? 'var(--ok)' : 'var(--fg-2)';
  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.18" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} V ${height} H ${x(pts[0].ts)} Z`} fill={`url(#${gid})`} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: 'easeOut' }} />
      {pts.filter((p) => p.triggered).map((p) => (
        <circle key={p.ts} cx={x(p.ts)} cy={y(p.numeric)} r="2.5" fill="var(--accent)" />
      ))}
      <circle cx={x(t1)} cy={y(last.numeric)} r="2" fill={color} />
    </svg>
  );
}
