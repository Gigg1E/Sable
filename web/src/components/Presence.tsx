import { useEffect, useRef } from 'react';
import { cx } from '../lib/format';
import type { Mood } from './SableCharacter';

/**
 * Sable's presence: a dot-matrix display rendered every frame from math, not keyframes
 * (docs/design/character.md).
 *
 * The matrix is a square grid of dots. For every dot we compute a brightness from a small scene:
 * a sphere shaded with a moving light (Lambert), textured with 3D value noise, and a field per mood
 * (scan bands, turbulence, ripples, a bounce). Moods are blended with weights that ease toward the
 * current one, so changes melt into each other instead of cutting. The light leans toward your
 * pointer, so it seems to look at you. Brightness sets each dot's size and opacity; the unlit
 * matrix stays faintly visible, like an LED panel that's switched on.
 *
 * Cheap: ~30x30 dots on a 2D canvas, paused when off screen or the tab is hidden, a single
 * still frame with reduce motion.
 */

const MOODS: Mood[] = ['idle', 'thinking', 'working', 'waiting', 'happy', 'sleeping', 'frozen'];

// ── tiny math kit ──
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function hash3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Smooth 3D value noise in [0, 1]. */
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
const fbm = (x: number, y: number, z: number) => 0.55 * noise3(x, y, z) + 0.3 * noise3(x * 2.1, y * 2.1, z * 2.1) + 0.15 * noise3(x * 4.3, y * 4.3, z * 4.3);

function parseColor(css: string): [number, number, number] {
  const m = css.trim().match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = css.match(/\d+(\.\d+)?/g);
  return r ? [Number(r[0]), Number(r[1]), Number(r[2])] : [224, 165, 75];
}

/** The brightness of one point of the matrix, for one mood. u, v in [-1, 1]. */
function field(mood: Mood, u: number, v: number, t: number, lx: number, ly: number, seed: number) {
  const r = Math.hypot(u, v);
  // Sphere radius: breathes; bounces when happy; settles low when asleep.
  let R = 0.72 + 0.018 * Math.sin(t * 1.9);
  if (mood === 'happy') R = 0.7 + 0.09 * Math.abs(Math.sin(t * 4.2));
  if (mood === 'sleeping') R = 0.66 + 0.012 * Math.sin(t * 0.9);
  if (mood === 'frozen') R = 0.72;

  // Ripples reach past the sphere while waiting.
  let outside = 0;
  if (mood === 'waiting') {
    const ring = Math.sin(r * 13 - t * 4.5);
    outside = smooth(0.55, 1, ring) * smooth(1.05, R, r) * (r > R ? 1 : 0);
  }
  if (r >= R) return outside;

  // Point on the sphere and its normal; spin it about the vertical axis.
  const z = Math.sqrt(R * R - r * r);
  const nx = u / R, ny = v / R, nz = z / R;
  const spin = mood === 'working' ? t * 1.6 : mood === 'frozen' ? 0.6 : mood === 'sleeping' ? t * 0.08 : t * 0.35;
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const px = nx * cs + nz * sn, py = ny, pz = -nx * sn + nz * cs;

  // Lambert light from the pointer side, plus a little ambient.
  const ll = Math.hypot(lx, ly, 1);
  const lambert = clamp((nx * lx + ny * ly + nz) / ll);
  const edge = smooth(R, R - 0.06, r);
  const base = (0.12 + 0.88 * lambert) * edge;

  switch (mood) {
    case 'idle':
      return base * (0.7 + 0.3 * noise3(px * 2.2 + seed, py * 2.2, pz * 2.2 + t * 0.15));
    case 'thinking': {
      // Bands of light scan down the globe, broken up by noise.
      const band = 0.5 + 0.5 * Math.sin(py * 11 - t * 4 + noise3(px * 3, py * 3, pz * 3 + t * 0.3) * 3);
      return base * (0.25 + 0.75 * band * band);
    }
    case 'working': {
      const n = fbm(px * 2.6 + seed, py * 2.6 + t * 0.9, pz * 2.6);
      return base * (0.15 + 0.85 * smooth(0.35, 0.75, n));
    }
    case 'waiting':
      return Math.max(outside, base * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3))));
    case 'happy': {
      const sparkle = hash3(Math.floor(px * 9), Math.floor(py * 9), Math.floor(t * 6)) > 0.86 ? 0.5 : 0;
      return clamp(base * (0.85 + 0.15 * noise3(px * 3, py * 3, t)) + sparkle * edge);
    }
    case 'sleeping':
      return base * 0.32 * (0.75 + 0.25 * Math.sin(t * 0.9 + py * 2));
    case 'frozen':
      // A still, crystalline surface: facets from quantized noise.
      return base * (0.35 + 0.65 * Math.round(noise3(px * 3 + 7, py * 3, pz * 3) * 4) / 4);
  }
}

export function Presence({ mood = 'idle', size = 120, className, grid }: { mood?: Mood; size?: number; className?: string; grid?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    // Odd grid so there's a center dot; about one dot per 4.5 px.
    const G = grid ?? Math.max(9, Math.round(size / 4.5) | 1);
    const cell = (size * dpr) / G;
    const maxR = cell * 0.46;
    const seed = Math.random() * 100;

    // Colors come from the theme tokens, re-read when the theme changes.
    let amber: [number, number, number] = [224, 165, 75];
    let frost: [number, number, number] = [159, 208, 240];
    let dim: [number, number, number] = [120, 115, 105];
    const readColors = () => {
      const cs = getComputedStyle(canvas);
      amber = parseColor(cs.getPropertyValue('--accent'));
      frost = parseColor(cs.getPropertyValue('--sable-frost'));
      dim = parseColor(cs.getPropertyValue('--fg-3'));
    };
    readColors();
    const themeObs = new MutationObserver(readColors);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', readColors);

    // Mood weights ease toward the current mood.
    const weights: Record<Mood, number> = Object.fromEntries(MOODS.map((m) => [m, m === moodRef.current ? 1 : 0])) as Record<Mood, number>;
    // The light leans toward the pointer (smoothed).
    let lx = -0.45, ly = -0.55, tx = lx, ty = ly;
    const onPointer = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      const dx = (e.clientX - (b.left + b.width / 2)) / Math.max(200, window.innerWidth / 3);
      const dy = (e.clientY - (b.top + b.height / 2)) / Math.max(200, window.innerHeight / 3);
      tx = clamp(dx, -1.2, 1.2);
      ty = clamp(dy, -1.2, 1.2);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const born = performance.now();
    let visible = true;
    let raf = 0;
    let last = born;
    let frozenT = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const target = moodRef.current;
      for (const m of MOODS) weights[m] += ((m === target ? 1 : 0) - weights[m]) * (1 - Math.exp(-dt * 6));
      lx += (tx - lx) * (1 - Math.exp(-dt * 3));
      ly += (ty - ly) * (1 - Math.exp(-dt * 3));
      // Time stops while frozen, so the surface holds still.
      if (weights.frozen < 0.5) frozenT = now / 1000;
      const t = reduce ? 2 : frozenT;
      const reveal = reduce ? 2 : smooth(0, 0.9, (now - born) / 1000) * 1.6; // dots switch on from the center

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const active = MOODS.filter((m) => weights[m] > 0.01);
      const total = active.reduce((s, m) => s + weights[m], 0);
      const icy = weights.frozen / total;
      const col = [lerp(amber[0], frost[0], icy), lerp(amber[1], frost[1], icy), lerp(amber[2], frost[2], icy)];

      // Bucket dots by brightness so each bucket is one path and one fill.
      const BUCKETS = 10;
      const paths: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
      const faint = new Path2D();
      const c = (G - 1) / 2;
      for (let j = 0; j < G; j++) {
        for (let i = 0; i < G; i++) {
          const u = (i - c) / c, v = (j - c) / c;
          const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
          let val = 0;
          for (const m of active) val += weights[m] * field(m, u, v, t, lx, ly, seed);
          val = clamp(val / total) * smooth(reveal, reveal - 0.35, Math.hypot(u, v));
          if (val < 0.04) {
            faint.moveTo(x + maxR * 0.2, y);
            faint.arc(x, y, maxR * 0.2, 0, Math.PI * 2);
            continue;
          }
          const k = Math.min(BUCKETS - 1, Math.floor(val * BUCKETS));
          const rad = maxR * (0.25 + 0.75 * Math.sqrt(val));
          paths[k].moveTo(x + rad, y);
          paths[k].arc(x, y, rad, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = `rgba(${dim[0]},${dim[1]},${dim[2]},0.22)`;
      ctx.fill(faint);
      for (let k = 0; k < BUCKETS; k++) {
        ctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${0.3 + 0.7 * ((k + 0.5) / BUCKETS)})`;
        ctx.fill(paths[k]);
      }
      if (!reduce && visible) raf = requestAnimationFrame(draw);
    };

    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting && !document.hidden;
      if (visible && !was) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    });
    io.observe(canvas);
    const onVis = () => {
      const was = visible;
      visible = !document.hidden;
      if (visible && !was) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(draw);
    // With reduce motion, redraw once the mood changes.
    const still = reduce ? setInterval(() => requestAnimationFrame(draw), 800) : 0;

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(still);
      io.disconnect();
      themeObs.disconnect();
      mq.removeEventListener('change', readColors);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [size, grid]);

  return <canvas ref={ref} style={{ width: size, height: size }} className={cx('block shrink-0', className)} role="img" aria-label={`Sable, ${mood}`} />;
}
