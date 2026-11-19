/**
 * Models write math in several dialects: $…$, $$…$$, \(…\) and \[…\] (Qwen and most open models
 * use the backslash forms). Normalize them for remark-math, leaving code untouched. A single
 * $…$ only counts as math when it looks like TeX, so prices ("$5 and $10") stay plain text.
 */

const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
const DISPLAY = /\\\[([\s\S]+?)\\\]/g;
const INLINE = /\\\(([\s\S]+?)\\\)/g;
const SINGLE = /(^|[^$\\])\$(?!\$)([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?![$\d])/g;
/** $$…$$ alone on a line is display math (a centered block), not inline. */
const OWN_LINE = /^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm;
const LOOKS_LIKE_TEX = /[\\^_{}=]|^-?\d+(\.\d+)?$|^[a-zA-Z]$|^[a-zA-Z]\(|[a-zA-Z]\s*[+\-*/<>]|\d\s*[a-zA-Z]/;

export function normalizeMath(text: string): string {
  return text
    .split(CODE)
    .map((part, i) => {
      if (i % 2) return part;
      return part
        .replace(OWN_LINE, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(DISPLAY, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(INLINE, (_m, body: string) => `$$${body.trim()}$$`)
        .replace(SINGLE, (m, pre: string, body: string) => (LOOKS_LIKE_TEX.test(body) ? `${pre}$$${body}$$` : m));
    })
    .join('');
}
