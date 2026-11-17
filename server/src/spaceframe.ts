/** Builds a Space's document: theme variables + the postMessage bridge, around the agent's HTML. */

const THEMES = {
  dark: { bg: '#0f0f11', surface: '#151517', surface2: '#1b1b1e', fg: '#ececee', muted: '#a0a0a8', subtle: '#6a6a72', accent: '#e3a650', ok: '#3fcf8e', danger: '#f2705a', border: '#232326' },
  light: { bg: '#fafaf9', surface: '#ffffff', surface2: '#f4f4f2', fg: '#19191c', muted: '#5d5d64', subtle: '#8d8d94', accent: '#a26a14', ok: '#15803d', danger: '#c2410c', border: '#e6e6e3' },
};

const BRIDGE = `(function(){var n=0,p={};function call(t,x){return new Promise(function(res,rej){var id=++n;p[id]={res:res,rej:rej};parent.postMessage({__sable:true,id:id,type:t,payload:x},'*')})}
window.sable={get:function(k){return call('get',{key:k})},set:function(k,v){return call('set',{key:k,value:v})},all:function(){return call('all')},ask:function(q){return call('ask',{prompt:q})}};
addEventListener('message',function(e){var d=e.data;if(e.source===parent&&d&&d.__sableReply&&p[d.id]){var x=p[d.id];delete p[d.id];d.error?x.rej(new Error(d.error)):x.res(d.result)}});})();`;

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

export function spaceFrameHtml(html: string, theme: 'dark' | 'light') {
  const t = THEMES[theme];
  const css = `:root{--bg:${t.bg};--surface:${t.surface};--surface-2:${t.surface2};--fg:${t.fg};--muted:${t.muted};--subtle:${t.subtle};--accent:${t.accent};--ok:${t.ok};--danger:${t.danger};--border:${t.border};--radius:10px;color-scheme:${theme}}
html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}`;
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><script>${BRIDGE}</script><script>${CONTRAST}</script>`;
  const body = html.trim();
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, (m) => m + head);
  if (/<html[^>]*>/i.test(body)) return body.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}
