/** Builds a Space's document: theme variables + the postMessage bridge, around the agent's HTML. */

const THEMES = {
  dark: { bg: '#0f0f11', surface: '#151517', surface2: '#1b1b1e', fg: '#ececee', muted: '#a0a0a8', subtle: '#6a6a72', accent: '#e3a650', ok: '#3fcf8e', danger: '#f2705a', border: '#232326' },
  light: { bg: '#fafaf9', surface: '#ffffff', surface2: '#f4f4f2', fg: '#19191c', muted: '#5d5d64', subtle: '#8d8d94', accent: '#a26a14', ok: '#15803d', danger: '#c2410c', border: '#e6e6e3' },
};

const BRIDGE = `(function(){var n=0,p={};function call(t,x){return new Promise(function(res,rej){var id=++n;p[id]={res:res,rej:rej};parent.postMessage({__sable:true,id:id,type:t,payload:x},'*')})}
window.sable={get:function(k){return call('get',{key:k})},set:function(k,v){return call('set',{key:k,value:v})},all:function(){return call('all')},ask:function(q){return call('ask',{prompt:q})}};
addEventListener('message',function(e){var d=e.data;if(e.source===parent&&d&&d.__sableReply&&p[d.id]){var x=p[d.id];delete p[d.id];d.error?x.rej(new Error(d.error)):x.res(d.result)}});})();`;

export function spaceFrameHtml(html: string, theme: 'dark' | 'light') {
  const t = THEMES[theme];
  const css = `:root{--bg:${t.bg};--surface:${t.surface};--surface-2:${t.surface2};--fg:${t.fg};--muted:${t.muted};--subtle:${t.subtle};--accent:${t.accent};--ok:${t.ok};--danger:${t.danger};--border:${t.border};--radius:10px;color-scheme:${theme}}
html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}`;
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><script>${BRIDGE}</script>`;
  const body = html.trim();
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, (m) => m + head);
  if (/<html[^>]*>/i.test(body)) return body.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}
