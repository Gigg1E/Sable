/** Builds a Space's document: theme variables + the postMessage bridge, around the agent's HTML. */

const THEMES = {
  dark: { bg: '#10141b', surface: '#161b24', surface2: '#1c222d', fg: '#e7eaf0', muted: '#a4acba', subtle: '#6d7687', accent: '#e3a650', ok: '#3fcf8e', danger: '#f2705a', border: '#242b37' },
  light: { bg: '#f7f8fa', surface: '#ffffff', surface2: '#f2f4f8', fg: '#151a23', muted: '#545d6d', subtle: '#8a92a0', accent: '#a26a14', ok: '#15803d', danger: '#c2410c', border: '#e2e6ed' },
};

const BRIDGE = `(function(){var n=0,p={},cache=null,subs=[];function call(t,x){return new Promise(function(res,rej){var id=++n;p[id]={res:res,rej:rej};parent.postMessage({__sable:true,id:id,type:t,payload:x},'*')})}
function emit(k,v){subs.forEach(function(s){if(!s.key||s.key===k){try{s.fn(v,k)}catch(e){console.error(e)}}})}
window.sable={get:function(k){return call('get',{key:k})},set:function(k,v){if(cache)cache[k]=v;emit(k,v);return call('set',{key:k,value:v})},all:function(){return call('all').then(function(d){cache=d||{};return d})},
ask:function(q){return call('ask',{prompt:q})},
act:function(q){return call('act',{prompt:q})},
on:function(k,fn){if(typeof k==='function'){fn=k;k=null}var s={key:k,fn:fn};subs.push(s);return function(){subs=subs.filter(function(x){return x!==s})}}};
addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d)return;if(d.__sableReply&&p[d.id]){var x=p[d.id];delete p[d.id];d.error?x.rej(new Error(d.error)):x.res(d.result)}else if(d.__sableData){if(cache)cache[d.key]=d.value;emit(d.key,d.value)}});})();`;

/**
 * Sable's component kit for spaces: native elements are themed out of the box and a small set of
 * classes covers common blocks. The model still controls layout and can set its own accent, radius
 * and type through the space theme; colors always come from tokens, so light and dark both work.
 */
const KIT = `
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased}
body{padding:var(--pad)}
h1,h2,h3,h4{margin:0 0 .5em;line-height:1.2;letter-spacing:-.01em;color:var(--fg)}h1{font-size:1.6rem}h2{font-size:1.25rem}h3{font-size:1.05rem}
p{margin:0 0 .75em}small,.muted{color:var(--muted)}.subtle{color:var(--subtle)}
a{color:var(--accent);text-underline-offset:2px}
hr{border:0;border-top:1px solid var(--border);margin:1.25em 0}
code,pre,kbd{font-family:var(--mono);font-size:.88em}pre{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:.8em 1em;overflow:auto}
img{max-width:100%;border-radius:calc(var(--radius) - 2px)}
button,.btn{font:inherit;font-size:.92em;display:inline-flex;align-items:center;gap:.4em;height:2.2em;padding:0 .9em;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);color:var(--fg);cursor:pointer;transition:background .15s,border-color .15s,transform .05s}
button:hover,.btn:hover{border-color:var(--subtle)}button:active,.btn:active{transform:scale(.98)}
button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button.danger,.btn.danger{color:var(--danger)}button:disabled{opacity:.5;cursor:not-allowed}
input,select,textarea{font:inherit;font-size:.95em;color:var(--fg);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:.45em .7em;min-width:0}
input:focus,select:focus,textarea:focus,button:focus-visible{outline:2px solid color-mix(in oklab,var(--accent) 55%,transparent);outline-offset:1px}
input[type=checkbox],input[type=radio]{accent-color:var(--accent);width:1.05em;height:1.05em}
label{display:inline-flex;align-items:center;gap:.45em}
table{width:100%;border-collapse:collapse;font-size:.95em}th,td{text-align:left;padding:.55em .7em;border-bottom:1px solid var(--border)}th{color:var(--muted);font-weight:500;font-size:.85em}
tr:hover td{background:color-mix(in oklab,var(--surface-2) 60%,transparent)}
ul,ol{padding-left:1.2em}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1em 1.1em}
.grid{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fill,minmax(var(--min,220px),1fr))}
.row{display:flex;gap:var(--gap);align-items:center;flex-wrap:wrap}.col{display:flex;flex-direction:column;gap:var(--gap)}.spread{justify-content:space-between}
.stack>*+*{margin-top:var(--gap)}
.badge{display:inline-flex;align-items:center;height:1.55em;padding:0 .55em;border-radius:999px;font-size:.78em;background:var(--surface-2);color:var(--muted);border:1px solid var(--border)}
.badge.accent{background:color-mix(in oklab,var(--accent) 16%,transparent);color:var(--accent);border-color:transparent}.badge.ok{color:var(--ok)}.badge.danger{color:var(--danger)}
.stat{display:flex;flex-direction:column;gap:.15em}.stat .value{font-size:1.6em;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.stat .label{color:var(--muted);font-size:.85em}
.list{display:flex;flex-direction:column}.list>*{padding:.6em 0;border-bottom:1px solid var(--border)}.list>*:last-child{border-bottom:0}
.progress{height:.45em;border-radius:999px;background:var(--surface-2);overflow:hidden}.progress>span{display:block;height:100%;background:var(--accent);border-radius:inherit}
.tabs{display:flex;gap:.25em;border-bottom:1px solid var(--border)}.tabs>button{border:0;border-radius:0;background:none;color:var(--muted);border-bottom:2px solid transparent;height:2.4em}.tabs>button.active{color:var(--fg);border-bottom-color:var(--accent)}
.empty{color:var(--muted);text-align:center;padding:2em 1em;border:1px dashed var(--border);border-radius:var(--radius)}
.price{font-variant-numeric:tabular-nums;font-weight:600}.up{color:var(--danger)}.down{color:var(--ok)}
@media (max-width:520px){body{padding:calc(var(--pad) * .6)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export interface SpaceTheme {
  /** Accent color for buttons, links and highlights (any CSS color). */
  accent?: string;
  /** Corner style. */
  radius?: 'sharp' | 'soft' | 'round';
  font?: 'sans' | 'serif' | 'mono' | 'rounded';
  density?: 'compact' | 'comfortable' | 'airy';
}

const FONTS = {
  sans: "ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif",
  serif: "ui-serif,'Iowan Old Style','Palatino Linotype',Georgia,serif",
  mono: "ui-monospace,'SF Mono','Cascadia Code',Menlo,monospace",
  rounded: "ui-rounded,'SF Pro Rounded','Nunito',system-ui,sans-serif",
};

/** Agent CSS often hard-codes black/white; map those to theme tokens so both themes stay readable. */
function greyLevel(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t === 'black') return 0;
  if (t === 'white') return 255;
  let r: number, g: number, b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(t);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
  else return null;
  // Only neutral greys (not colors that happen to be dark or light).
  return Math.max(r, g, b) - Math.min(r, g, b) <= 18 ? (r + g + b) / 3 : null;
}
const COLOR_TOKEN = /#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|\b(?:black|white)\b/gi;

export function normalizeColors(html: string): string {
  const fixValue = (prop: string, val: string) =>
    val.replace(COLOR_TOKEN, (tok) => {
      const lvl = greyLevel(tok);
      if (lvl == null) return tok;
      if (/^color$/i.test(prop) && lvl < 80) return 'var(--fg)';
      if (/^color$/i.test(prop) && lvl > 215) return 'var(--fg)'; // white text assumes a dark page
      if (/^background(-color)?$/i.test(prop) && lvl > 225) return 'var(--surface)';
      if (/^background(-color)?$/i.test(prop) && lvl < 40) return 'var(--surface-2)';
      if (/^border(-\w+)?(-color)?$/i.test(prop) && (lvl > 200 || lvl < 60)) return 'var(--border)';
      return tok;
    });
  const fix = (block: string) => block.replace(/(^|[;{\s"'])(color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?)(\s*:\s*)([^;}"']+)/gi, (_m, pre: string, prop: string, sep: string, val: string) => pre + prop + sep + fixValue(prop, val));
  return html
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a: string, css: string, b: string) => a + fix(css) + b)
    .replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (m) => fix(m));
}

/**
 * Safety net for hard-coded colors (black text written for a light page, shown in dark mode):
 * any text whose contrast with the background behind it is too low is switched to the theme's
 * text color. Re-checked when the page changes. Intentional designs with readable colors are untouched.
 */
const CONTRAST = `(function(){
function rgb(s){var m=s&&s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;var p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}}
function lum(c){function f(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)}
function bgOf(el){for(var e=el;e&&e.nodeType===1;e=e.parentElement){var c=rgb(getComputedStyle(e).backgroundColor);if(c&&c.a>0.5)return c}return rgb(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().replace(/^#(..)(..)(..)$/,function(_,a,b,c){return 'rgb('+parseInt(a,16)+','+parseInt(b,16)+','+parseInt(c,16)+')'}))||{r:255,g:255,b:255,a:1}}
function fix(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),seen=new Set(),n;while(n=w.nextNode()){var el=n.parentElement;if(!el||seen.has(el)||!n.textContent.trim())continue;seen.add(el);if(/^(SCRIPT|STYLE)$/.test(el.tagName))continue;var fg=rgb(getComputedStyle(el).color);if(!fg||fg.a<0.2)continue;var a=lum(fg),b=lum(bgOf(el));var ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);if(ratio<2.6)el.style.setProperty('color',b<0.4?'var(--fg)':'#19191c','important')}}
var t;function soon(){clearTimeout(t);t=setTimeout(fix,120)}
addEventListener('load',fix);document.addEventListener('DOMContentLoaded',fix);new MutationObserver(soon).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style']});})();`;

export function spaceFrameHtml(html: string, theme: 'dark' | 'light', st: SpaceTheme = {}) {
  const t = THEMES[theme];
  const accent = st.accent && /^[#a-z0-9(),.%\s-]{3,40}$/i.test(st.accent) ? st.accent : t.accent;
  const radius = { sharp: '4px', soft: '10px', round: '16px' }[st.radius ?? 'soft'];
  const pad = { compact: '12px', comfortable: '20px', airy: '32px' }[st.density ?? 'comfortable'];
  const gap = { compact: '8px', comfortable: '12px', airy: '20px' }[st.density ?? 'comfortable'];
  // In dark mode a custom accent is lifted a little so it stays readable on dark surfaces.
  const accentVar = theme === 'dark' && st.accent ? `color-mix(in oklab, ${accent} 82%, white)` : accent;
  const css = `:root{--bg:${t.bg};--surface:${t.surface};--surface-2:${t.surface2};--fg:${t.fg};--muted:${t.muted};--subtle:${t.subtle};--accent:${accentVar};--on-accent:${theme === 'dark' ? '#0c1016' : '#ffffff'};--ok:${t.ok};--danger:${t.danger};--border:${t.border};--radius:${radius};--pad:${pad};--gap:${gap};--font:${FONTS[st.font ?? 'sans']};--mono:${FONTS.mono};color-scheme:${theme}}${KIT}`;
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><script>${BRIDGE}</script><script>${CONTRAST}</script>`;
  const body = normalizeColors(html.trim());
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, (m) => m + head);
  if (/<html[^>]*>/i.test(body)) return body.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}
