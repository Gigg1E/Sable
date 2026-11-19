import { compile } from '../../expr.js';
import { registerTool, type Card } from './registry.js';

/**
 * Interactive graphs: the model fills in a ready-made graph (functions, points, sequences,
 * sliders) and the chat draws it with pan, zoom, draggable points and live sliders. Every formula
 * is checked here first, so the model gets a clear error to fix instead of a blank graph.
 */

const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,15}$/;
const RESERVED = new Set(['x', 'y', 't', 'n', 'pi', 'e', 'tau']);

interface Param {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
}

function num(v: unknown, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

registerTool({
  name: 'show_graph',
  label: 'Show graph',
  group: 'Math',
  description:
    "Draw an interactive graph in the chat: the user can pan, zoom, drag points and move sliders. Use it for functions, equations, sequences, data points, parametric curves and anything a picture explains better. Formulas use x (functions), t (parametric), n (sequences), standard operators (+ - * / ^), implicit multiplication (2x, 3(x+1)) and functions sin cos tan asin acos atan sqrt abs ln log exp floor ceil round min max. Add params (sliders) to let the user explore, e.g. y = a*x^2 + b with sliders a and b. Points can be movable, and can be locked onto a function (on: index of the function) so dragging traces the curve. Also write the math in your reply with LaTeX ($…$ or $$…$$).",
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      x_range: { type: 'array', items: { type: 'number' }, description: '[min, max] of the visible x axis (default -10..10, or fitted to sequences/points)' },
      y_range: { type: 'array', items: { type: 'number' }, description: '[min, max] of the visible y axis (default: fitted to the curves)' },
      functions: {
        type: 'array',
        items: { type: 'object', properties: { expr: { type: 'string', description: 'In x and params, e.g. "x^2 - 3x + 2" or "a*sin(b*x)"' }, label: { type: 'string' } }, required: ['expr'] },
      },
      parametric: {
        type: 'array',
        items: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'string' }, t_range: { type: 'array', items: { type: 'number' } }, label: { type: 'string' } }, required: ['x', 'y'] },
      },
      sequence: {
        type: 'object',
        description: 'Plot terms a_n as points (n, a_n) with a table of values',
        properties: { expr: { type: 'string', description: 'In n, e.g. "n/(n+8)"' }, from: { type: 'integer' }, to: { type: 'integer' }, label: { type: 'string' } },
        required: ['expr'],
      },
      points: {
        type: 'array',
        items: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, label: { type: 'string' }, movable: { type: 'boolean' }, on: { type: 'integer', description: 'Lock a movable point onto functions[on]' } },
          required: ['x', 'y'],
        },
      },
      params: {
        type: 'array',
        description: 'Sliders: names used in the formulas',
        items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number' } }, required: ['name', 'value'] },
      },
    },
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Graph${a.title ? ` “${a.title}”` : ''}`,
  async run(a) {
    const errors: string[] = [];
    const params: Param[] = [];
    for (const p of (Array.isArray(a.params) ? a.params : []).slice(0, 8)) {
      const name = String(p?.name ?? '');
      if (!NAME.test(name) || RESERVED.has(name)) {
        errors.push(`Slider name "${name}" isn't allowed (use a letter like a, b, k; not x, y, t, n, e, pi).`);
        continue;
      }
      const value = num(p.value, 1);
      const min = num(p.min, Math.min(value, 0) - 5);
      const max = num(p.max, Math.max(value, 0) + 5);
      params.push({ name, value, min: Math.min(min, value), max: Math.max(max, value), step: p.step ? num(p.step, 0.1) : undefined });
    }
    const pnames = params.map((p) => p.name);
    const check = (expr: unknown, vars: string[], what: string) => {
      try {
        compile(String(expr ?? ''), vars);
        return String(expr);
      } catch (err) {
        errors.push(`${what} "${expr}": ${(err as Error).message}`);
        return null;
      }
    };
    const functions = (Array.isArray(a.functions) ? a.functions : [])
      .slice(0, 6)
      .map((f: { expr?: string; label?: string }, i: number) => ({ expr: check(f?.expr, ['x', ...pnames], `Function ${i + 1}`), label: f?.label ? String(f.label).slice(0, 60) : undefined }))
      .filter((f: { expr: string | null }) => f.expr) as { expr: string; label?: string }[];
    const parametric = (Array.isArray(a.parametric) ? a.parametric : [])
      .slice(0, 4)
      .map((c: { x?: string; y?: string; t_range?: number[]; label?: string }, i: number) => {
        const x = check(c?.x, ['t', ...pnames], `Curve ${i + 1} x`);
        const y = check(c?.y, ['t', ...pnames], `Curve ${i + 1} y`);
        const tr = Array.isArray(c?.t_range) && c.t_range.length === 2 ? [num(c.t_range[0], 0), num(c.t_range[1], 2 * Math.PI)] : [0, 2 * Math.PI];
        return x && y ? { x, y, t: tr, label: c?.label } : null;
      })
      .filter(Boolean);
    let sequence: { expr: string; from: number; to: number; label: string } | undefined;
    if (a.sequence?.expr) {
      const expr = check(a.sequence.expr, ['n', ...pnames], 'Sequence');
      const from = Math.round(num(a.sequence.from, 1));
      const to = Math.max(from, Math.min(from + 199, Math.round(num(a.sequence.to, from + 9))));
      if (expr) sequence = { expr, from, to, label: a.sequence.label ? String(a.sequence.label) : 'a_n' };
    }
    const points = (Array.isArray(a.points) ? a.points : []).slice(0, 30).map((p: Record<string, unknown>) => ({
      x: num(p.x, 0),
      y: num(p.y, 0),
      label: p.label ? String(p.label).slice(0, 40) : undefined,
      movable: !!p.movable,
      on: Number.isInteger(p.on) && (p.on as number) >= 0 && (p.on as number) < functions.length ? (p.on as number) : undefined,
    }));
    if (!functions.length && !parametric.length && !sequence && !points.length) return `Nothing to draw.${errors.length ? ` Fix: ${errors.join(' ')}` : ''}`;
    const range = (r: unknown) => (Array.isArray(r) && r.length === 2 && Number.isFinite(Number(r[0])) && Number(r[1]) > Number(r[0]) ? [Number(r[0]), Number(r[1])] : undefined);
    const card: Card = { type: 'graph', title: a.title ? String(a.title).slice(0, 80) : undefined, x: range(a.x_range), y: range(a.y_range), functions, parametric, sequence, points, params };
    const parts = [functions.length && `${functions.length} function${functions.length > 1 ? 's' : ''}`, parametric.length && 'parametric curves', sequence && 'a sequence', points.length && `${points.length} points`, params.length && `sliders ${pnames.join(', ')}`].filter(Boolean);
    return { content: `Showing an interactive graph with ${parts.join(', ')}.${errors.length ? ` Some parts were skipped: ${errors.join(' ')}` : ''}`, cards: [card] };
  },
});
