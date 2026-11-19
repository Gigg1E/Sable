import { Coordinates, Mafs, MovablePoint, Plot, Point, Text, type vec } from 'mafs';
import 'mafs/core.css';
import { motion } from 'motion/react';
import { Eye, EyeOff, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { compile } from '../lib/expr';
import { cx } from '../lib/format';

export interface GraphCardData {
  type: 'graph';
  title?: string;
  x?: [number, number];
  y?: [number, number];
  functions: { expr: string; label?: string }[];
  parametric: { x: string; y: string; t: [number, number]; label?: string }[];
  sequence?: { expr: string; from: number; to: number; label: string };
  points: { x: number; y: number; label?: string; movable?: boolean; on?: number }[];
  params: { name: string; value: number; min: number; max: number; step?: number }[];
}

const COLORS = ['var(--tint)', 'var(--accent)', 'var(--ok)', 'var(--danger)', '#a78bfa', '#ec4899'];
const fmt = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0) ? v.toExponential(2) : String(Math.round(v * 1000) / 1000)) : '—');

/** Pretty label: "x^2 - 3x" → "x² − 3x" for legends. */
const pretty = (s: string) =>
  s.replace(/\^2(?![\d.])/g, '²').replace(/\^3(?![\d.])/g, '³').replace(/\*/g, '·').replace(/-/g, '−').replace(/sqrt/g, '√').replace(/pi/g, 'π');

/** A round grid step (1, 2, 5 × 10^k) giving about `target` lines across the span. */
function niceStep(span: number, target = 8) {
  const raw = Math.abs(span) / target;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function niceRange(values: number[], pad = 0.15): [number, number] | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  // Ignore extreme tails (asymptotes) so the interesting part fills the view.
  const lo = v[Math.floor(v.length * 0.04)];
  const hi = v[Math.ceil(v.length * 0.96) - 1];
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

export default function GraphCard({ card }: { card: GraphCardData }) {
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(card.params.map((p) => [p.name, p.value])));
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [pts, setPts] = useState<vec.Vector2[]>(() => card.points.map((p) => [p.x, p.y]));
  const [view, setView] = useState(0); // bump to reset pan/zoom
  const [big, setBig] = useState(false);
  const pnames = card.params.map((p) => p.name);

  const fns = useMemo(
    () =>
      card.functions.map((f) => {
        try {
          const g = compile(f.expr, ['x', ...pnames]);
          return (x: number) => g({ ...values, x });
        } catch {
          return () => NaN;
        }
      }),
    [card.functions, values], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const curves = useMemo(
    () =>
      card.parametric.map((c) => {
        try {
          const fx = compile(c.x, ['t', ...pnames]);
          const fy = compile(c.y, ['t', ...pnames]);
          return (t: number): vec.Vector2 => [fx({ ...values, t }), fy({ ...values, t })];
        } catch {
          return (): vec.Vector2 => [NaN, NaN];
        }
      }),
    [card.parametric, values], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const seq = useMemo(() => {
    if (!card.sequence) return [];
    try {
      const g = compile(card.sequence.expr, ['n', ...pnames]);
      const out: { n: number; v: number }[] = [];
      for (let n = card.sequence.from; n <= card.sequence.to; n++) out.push({ n, v: g({ ...values, n }) });
      return out;
    } catch {
      return [];
    }
  }, [card.sequence, values]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep points locked to a function on the curve as sliders change it.
  useEffect(() => {
    setPts((cur) => cur.map((p, i) => (card.points[i]?.on !== undefined ? [p[0], fns[card.points[i].on!](p[0])] : p)));
  }, [fns]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewBox = useMemo(() => {
    const xs = card.x ?? (seq.length ? [Math.min(0, seq[0].n - 1), seq[seq.length - 1].n + 1] : card.points.length ? (niceRange(card.points.map((p) => p.x), 0.3) ?? [-10, 10]) : [-10, 10]);
    let ys = card.y;
    if (!ys) {
      const samples: number[] = [];
      fns.forEach((f, i) => {
        if (hidden.has(i)) return;
        for (let k = 0; k <= 200; k++) samples.push(f(xs[0] + ((xs[1] - xs[0]) * k) / 200));
      });
      curves.forEach((c) => {
        const t = card.parametric[0]?.t ?? [0, 2 * Math.PI];
        for (let k = 0; k <= 100; k++) samples.push(c(t[0] + ((t[1] - t[0]) * k) / 100)[1]);
      });
      samples.push(...seq.map((s) => s.v), ...card.points.map((p) => p.y));
      const r = niceRange(samples);
      ys = r ? [Math.min(r[0], 0), Math.max(r[1], 0)] : [-10, 10];
    }
    return { x: xs as vec.Vector2, y: ys as vec.Vector2 };
  }, [card, view, seq.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasLegend = card.functions.length + card.parametric.length > 1 || card.functions.some((f) => f.label);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx('graph-card my-2.5 overflow-hidden rounded-xl border border-line bg-panel', big && 'fixed inset-3 z-50 my-0 flex flex-col shadow-2 md:inset-10')}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{card.title ?? 'Graph'}</span>
        {hasLegend &&
          [...card.functions.map((f) => f.label ?? `y = ${pretty(f.expr)}`), ...card.parametric.map((c, i) => c.label ?? `curve ${i + 1}`)].map((label, i) => (
            <button
              key={i}
              onClick={() => setHidden((h) => (h.has(i) ? new Set([...h].filter((x) => x !== i)) : new Set([...h, i])))}
              className={cx('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] hover:bg-panel-2', hidden.has(i) ? 'text-fg-3 line-through' : 'text-fg-2')}
              title={hidden.has(i) ? 'Show' : 'Hide'}
            >
              <span className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              {label}
              {hidden.has(i) ? <EyeOff className="size-3" /> : <Eye className="size-3 opacity-0" />}
            </button>
          ))}
        <button onClick={() => setView((v) => v + 1)} title="Reset view" className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg">
          <RotateCcw className="size-3.5" />
        </button>
        <button onClick={() => setBig((b) => !b)} title={big ? 'Shrink' : 'Expand'} className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-fg">
          {big ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>

      <div className={cx('touch-none', big && 'min-h-0 flex-1')}>
        <Mafs key={view} height={big ? Math.max(320, window.innerHeight - 260) : 340} viewBox={{ ...viewBox, padding: 0 }} preserveAspectRatio={false} pan zoom={{ min: 0.05, max: 20 }}>
          <Coordinates.Cartesian
            subdivisions={2}
            xAxis={{ lines: niceStep(viewBox.x[1] - viewBox.x[0], big ? 14 : 10), labels: (v) => fmt(v) }}
            yAxis={{ lines: niceStep(viewBox.y[1] - viewBox.y[0], big ? 10 : 6), labels: (v) => fmt(v) }}
          />
          {fns.map((f, i) => (hidden.has(i) ? null : <Plot.OfX key={`f${i}`} y={f} color={COLORS[i % COLORS.length]} weight={2.5} />))}
          {curves.map((c, i) =>
            hidden.has(card.functions.length + i) ? null : <Plot.Parametric key={`p${i}`} xy={c} domain={card.parametric[i].t as vec.Vector2} color={COLORS[(card.functions.length + i) % COLORS.length]} weight={2.5} />,
          )}
          {seq.map((s) => (Number.isFinite(s.v) ? <Point key={`s${s.n}`} x={s.n} y={s.v} color="var(--tint)" /> : null))}
          {pts.map((p, i) => {
            const spec = card.points[i];
            const label = (
              <Text key={`t${i}`} x={p[0]} y={p[1]} attach="ne" size={13} color="var(--fg-2)">
                {`${spec.label ? `${spec.label} ` : ''}(${fmt(p[0])}, ${fmt(p[1])})`}
              </Text>
            );
            if (!spec.movable) return [<Point key={`q${i}`} x={p[0]} y={p[1]} color="var(--accent)" />, label];
            const f = spec.on !== undefined ? fns[spec.on] : undefined;
            return [
              <MovablePoint
                key={`m${i}`}
                point={p}
                color="var(--accent)"
                constrain={f ? ([x]) => [x, f(x)] : undefined}
                onMove={(np) => setPts((cur) => cur.map((c, j) => (j === i ? np : c)))}
              />,
              label,
            ];
          })}
        </Mafs>
      </div>

      {card.params.length > 0 && (
        <div className="grid gap-x-5 gap-y-2 border-t border-line px-3.5 py-3 sm:grid-cols-2">
          {card.params.map((p) => (
            <label key={p.name} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-16 shrink-0 font-mono text-fg-2">
                {p.name} = <b className="text-fg">{fmt(values[p.name])}</b>
              </span>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step ?? niceStep(p.max - p.min, 60)}
                value={values[p.name]}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: Number(e.target.value) }))}
                className="min-w-0 flex-1 accent-[var(--tint)]"
              />
            </label>
          ))}
        </div>
      )}

      {seq.length > 0 && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-[12.5px] tabular-nums">
            <tbody>
              <tr>
                <th className="w-12 bg-panel-2/60 px-3 py-1.5 text-left font-mono font-normal text-fg-3">n</th>
                {seq.slice(0, 12).map((s) => (
                  <td key={s.n} className="px-3 py-1.5 text-center font-mono text-fg-2">
                    {s.n}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <th className="bg-panel-2/60 px-3 py-1.5 text-left font-mono font-normal text-fg-3">{card.sequence?.label ?? 'aₙ'}</th>
                {seq.slice(0, 12).map((s) => (
                  <td key={s.n} className="px-3 py-1.5 text-center font-mono">
                    {fmt(s.v)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-3.5 py-1.5 text-[11px] text-fg-3">Drag to pan · scroll or pinch to zoom{card.points.some((p) => p.movable) ? ' · drag the orange points' : ''}</div>
    </motion.div>
  );
}
