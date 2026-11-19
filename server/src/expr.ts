/**
 * A small, safe math expression parser for graphs: numbers, variables, + - * / ^, parentheses,
 * unary minus, implicit multiplication (2x, 3(x+1), (x+1)(x-1)), and common functions/constants.
 * Compiles to a closure; no eval, no access to anything outside the given variables.
 * (Shared with the server, which uses an identical copy to validate what the agent sends.)
 */

type Node = { k: 'num'; v: number } | { k: 'var'; n: string } | { k: 'un'; op: string; a: Node } | { k: 'bin'; op: string; a: Node; b: Node } | { k: 'fn'; n: string; args: Node[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, min: Math.min, max: Math.max,
  mod: (a, b) => ((a % b) + b) % b,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
// Own keys only: names like "constructor" must never resolve to built-in object properties.
const isFn = (n: string) => Object.prototype.hasOwnProperty.call(FUNCS, n);
const isConst = (n: string) => Object.prototype.hasOwnProperty.call(CONSTS, n);

function tokenize(src: string): string[] {
  const s = src.replace(/\*\*/g, '^').replace(/π/g, 'pi').replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      out.push(num[0]);
      i += num[0].length;
      continue;
    }
    const id = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(s.slice(i));
    if (id) {
      out.push(id[0]);
      i += id[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(c)) {
      out.push(c);
      i++;
      continue;
    }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

export function parse(src: string, vars: string[]): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: string) => {
    if (next() !== t) throw new Error(`Expected "${t}"`);
  };
  const isAtomStart = (t?: string) => t !== undefined && (t === '(' || /^[\d.]/.test(t) || /^[a-zA-Z_]/.test(t));
  // Split identifiers like "xy" or "2pi x" into known pieces when they aren't a function or variable.
  const ident = (name: string): Node => {
    if (vars.includes(name)) return { k: 'var', n: name };
    if (isConst(name)) return { k: 'num', v: CONSTS[name] };
    // Implicit products of single-letter variables and constants, e.g. "ax" → a*x.
    for (let i = name.length - 1; i > 0; i--) {
      const a = name.slice(0, i);
      const b = name.slice(i);
      if ((vars.includes(a) || isConst(a)) && (vars.includes(b) || isConst(b) || /^[a-zA-Z_]/.test(b))) {
        try {
          return { k: 'bin', op: '*', a: ident(a), b: ident(b) };
        } catch {
          /* keep trying */
        }
      }
    }
    throw new Error(`Unknown name "${name}"${vars.length ? ` (variables: ${vars.join(', ')})` : ''}`);
  };
  function atom(): Node {
    const t = next();
    if (t === undefined) throw new Error('Unexpected end');
    if (t === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    if (/^[\d.]/.test(t)) return { k: 'num', v: Number(t) };
    if (/^[a-zA-Z_]/.test(t)) {
      if (isFn(t) && peek() === '(') {
        next();
        const args: Node[] = [];
        if (peek() !== ')') {
          args.push(expr());
          while (peek() === ',') {
            next();
            args.push(expr());
          }
        }
        expect(')');
        return { k: 'fn', n: t, args };
      }
      if (isFn(t) && isAtomStart(peek())) return { k: 'fn', n: t, args: [power()] }; // "sin x"
      return ident(t);
    }
    throw new Error(`Unexpected "${t}"`);
  }
  function power(): Node {
    const base = atom();
    if (peek() === '^') {
      next();
      return { k: 'bin', op: '^', a: base, b: unary() }; // right-associative
    }
    return base;
  }
  function unary(): Node {
    if (peek() === '-') {
      next();
      return { k: 'un', op: '-', a: unary() };
    }
    if (peek() === '+') {
      next();
      return unary();
    }
    return power();
  }
  function term(): Node {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/') {
        next();
        a = { k: 'bin', op: t, a, b: unary() };
      } else if (isAtomStart(t)) a = { k: 'bin', op: '*', a, b: power() }; // implicit multiplication
      else return a;
    }
  }
  function expr(): Node {
    let a = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  }
  const tree = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p]}"`);
  return tree;
}

export function compile(src: string, vars: string[]): (scope: Record<string, number>) => number {
  // Allow "y = …" / "f(x) = …" by dropping the left side.
  const body = src.includes('=') ? src.slice(src.lastIndexOf('=') + 1) : src;
  const tree = parse(body, vars);
  const run = (n: Node, s: Record<string, number>): number => {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'var':
        return s[n.n] ?? NaN;
      case 'un':
        return -run(n.a, s);
      case 'fn':
        return FUNCS[n.n](...n.args.map((a) => run(a, s)));
      case 'bin': {
        const a = run(n.a, s);
        const b = run(n.b, s);
        return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b);
      }
    }
  };
  return (scope) => run(tree, scope);
}
