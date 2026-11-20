import { agentFetch } from '../../net.js';
import { getSettings } from '../../settings.js';
import { truncate, untrusted } from '../../util.js';
import { registerTool } from './registry.js';
import { addItem, wasForgotten } from '../../library.js';

const MAX_BYTES = 3_000_000;

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Rough HTML → readable text: keeps headings, list items, links and paragraphs. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
  let body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|footer)[\s\S]*?<\/\1>/gi, ' ');
  body = body
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      return t && /^https?:/.test(href) ? `[${t}](${href})` : t;
    })
    .replace(/<(br|\/p|\/div|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*(\n\s*)+/g, '\n\n')
    .trim();
  return { title, text };
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

registerTool({
  name: 'web_search',
  label: 'Web search',
  group: 'Web',
  description: 'Search the web. Returns titles, URLs and snippets. Follow up with web_fetch to read a page.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: 'Max results (default 8)' } }, required: ['query'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Search the web for “${a.query}”`,
  async run(a, ctx) {
    const limit = Math.min(Number(a.limit) || 8, 20);
    const searx = getSettings().web.searxngUrl.replace(/\/+$/, '');
    let results: { title: string; url: string; snippet: string }[] = [];
    if (searx) {
      const res = await agentFetch(`${searx}/search?format=json&q=${encodeURIComponent(a.query)}`, {}, ctx.signal);
      if (!res.ok) throw new Error(`SearXNG returned ${res.status}`);
      const data = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
      results = (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
    } else {
      const res = await agentFetch(
        'https://html.duckduckgo.com/html/',
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(a.query)}` },
        ctx.signal,
      );
      if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}. Configure a SearXNG instance in Settings → Web for reliable search.`);
      const html = await res.text();
      const blocks = html.split(/class="result results_links/).slice(1);
      for (const b of blocks) {
        const link = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!link) continue;
        let url = decodeEntities(link[1]);
        const uddg = url.match(/[?&]uddg=([^&]+)/);
        if (uddg) url = decodeURIComponent(uddg[1]);
        if (url.startsWith('//')) url = 'https:' + url;
        const snippet = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '';
        results.push({ title: decodeEntities(link[2].replace(/<[^>]+>/g, '')).trim(), url, snippet: decodeEntities(snippet.replace(/<[^>]+>/g, '')).trim() });
      }
      if (!results.length && /anomaly|captcha/i.test(html)) throw new Error('DuckDuckGo rate-limited this server. Configure a SearXNG instance in Settings → Web.');
    }
    results = results.slice(0, limit);
    if (!results.length) return 'No results.';
    return untrusted('web_search', results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n'));
  },
});

registerTool({
  name: 'web_fetch',
  label: 'Read web page',
  group: 'Web',
  description: 'Fetch a URL and return its readable text (HTML is converted to Markdown-ish text; JSON and text pass through).',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' }, max_chars: { type: 'integer', description: 'Default 20000' } },
    required: ['url'],
  },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Read ${a.url}`,
  scope: (a) => {
    const h = hostOf(String(a.url));
    return h ? { kind: 'domain', value: h } : undefined;
  },
  async run(a, ctx) {
    const url = String(a.url);
    if (!/^https?:\/\//i.test(url)) return 'Only http(s) URLs can be fetched.';
    const res = await agentFetch(url, {}, ctx.signal);
    const type = res.headers.get('content-type') ?? '';
    const raw = await readCapped(res);
    let out: string;
    if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw)) {
      const { title, text } = htmlToText(raw);
      out = `Title: ${title}\nURL: ${res.url}\nStatus: ${res.status}\n\n${text}`;
    } else {
      out = `URL: ${res.url}\nStatus: ${res.status}\nContent-Type: ${type}\n\n${raw}`;
    }
    // Pages Sable reads go into the Library (open unless they hold personal details), so any chat can find them later.
    if (res.ok && out.length > 400) {
      try {
        const title = /^Title: (.*)$/m.exec(out)?.[1]?.trim() || hostOf(res.url) || res.url;
        if (!wasForgotten(out, res.url)) addItem({ kind: 'page', title, body: out.slice(0, 200_000), source: 'web', url: res.url, conversationId: ctx.conversationId, trust: 'external' });
      } catch {
        /* the Library is a bonus; never fail the fetch over it */
      }
    }
    return untrusted(hostOf(res.url) ?? 'web', truncate(out, Number(a.max_chars) || 20_000));
  },
});

registerTool({
  name: 'http_request',
  label: 'HTTP request',
  group: 'Web',
  description: 'Make an HTTP request to an API (any method, custom headers, JSON or text body). Returns status, headers and body.',
  parameters: {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      url: { type: 'string' },
      headers: { type: 'object' },
      body: { type: 'string', description: 'Request body (JSON as a string)' },
    },
    required: ['method', 'url'],
  },
  risk: 'high',
  defaultPolicy: 'ask',
  summarize: (a) => `${a.method} ${a.url}`,
  scope: (a) => {
    const h = hostOf(String(a.url));
    return h ? { kind: 'domain', value: h } : undefined;
  },
  async run(a, ctx) {
    const res = await agentFetch(String(a.url), { method: String(a.method), headers: (a.headers as Record<string, string>) ?? {}, body: a.body ?? undefined }, ctx.signal);
    const body = await readCapped(res);
    const headers = [...res.headers.entries()].filter(([k]) => /content-type|location|retry-after/i.test(k)).map(([k, v]) => `${k}: ${v}`).join('\n');
    return untrusted(hostOf(res.url) ?? 'http', truncate(`Status: ${res.status}\n${headers}\n\n${body}`, 20_000));
  },
});
