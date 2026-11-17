import * as cheerio from 'cheerio';
import { agentFetch } from '../../net.js';
import { getSettings } from '../../settings.js';
import { errorMessage, untrusted } from '../../util.js';
import { domainMatches } from '../sentinel.js';
import { extractPrice } from '../watchers.js';
import { registerTool, type Card } from './registry.js';

/**
 * Show, don't describe: link previews and pictures as cards, inline at the point in the turn
 * where the agent calls these tools. Every title, picture and price is read from the real page
 * by the server, so cards never carry details the model made up.
 */

export interface LinkItem {
  url: string;
  site: string;
  title: string;
  description?: string;
  image?: string;
  price?: string;
  note?: string;
  ok: boolean;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const clean = (s: string | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? t.slice(0, max - 1) + '…' : t) : undefined;
};

/** Absolute https URL for a picture, or nothing (http pictures would be blocked on an https page). */
function pictureUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim(), base);
    if (u.protocol === 'http:') u.protocol = 'https:';
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function blocked(url: string) {
  const h = host(url);
  return !h || domainMatches(h, getSettings().blockedDomains);
}

async function readSome(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function previewLink(url: string, signal?: AbortSignal): Promise<LinkItem> {
  const fallback: LinkItem = { url, site: host(url), title: host(url) || url, ok: false };
  if (!/^https?:\/\//i.test(url) || blocked(url)) return fallback;
  try {
    const res = await agentFetch(url, { headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } }, AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]));
    const final = res.url || url;
    if (!res.ok) return { ...fallback, url: final };
    const type = res.headers.get('content-type') ?? '';
    if (/^image\//i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { url: final, site: host(final), title: decodeURIComponent(new URL(final).pathname.split('/').pop() || host(final)), image: pictureUrl(final, final), ok: true };
    }
    if (!/html/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { ...fallback, url: final, ok: true };
    }
    const $ = cheerio.load(await readSome(res, 1_500_000));
    const meta = (...names: string[]) => {
      for (const n of names) {
        const v = $(`meta[property="${n}"]`).attr('content') ?? $(`meta[name="${n}"]`).attr('content');
        if (v?.trim()) return v.trim();
      }
      return undefined;
    };
    const price = extractPrice($);
    return {
      url: final,
      site: clean(meta('og:site_name'), 40) ?? host(final),
      title: clean(meta('og:title', 'twitter:title') ?? $('title').first().text(), 140) ?? host(final),
      description: clean(meta('og:description', 'twitter:description', 'description'), 220),
      image: pictureUrl(meta('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src') ?? $('link[rel="image_src"]').attr('href') ?? $('[itemprop="image"]').first().attr('content'), final),
      price: price ? price.value : undefined,
      ok: true,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return fallback;
  }
}

registerTool({
  name: 'show_links',
  label: 'Show links',
  group: 'Web',
  description:
    "Show web pages to the user as preview cards (title, site, picture, and price when the page lists one), right where you call it in your reply. Use it for products, articles, places and sources you recommend, instead of pasting bare links. The details are read from the real pages, so don't repeat prices or titles that aren't in the result.",
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional heading above the cards, e.g. "Current prices"' },
      links: {
        type: 'array',
        description: 'Up to 8 pages',
        items: { type: 'object', properties: { url: { type: 'string' }, note: { type: 'string', description: 'One short line shown under the card, e.g. "Best value" or "Check cooler inclusion"' } }, required: ['url'] },
      },
    },
    required: ['links'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Show ${(a.links ?? []).length} link${(a.links ?? []).length === 1 ? '' : 's'}`,
  async run(a, ctx) {
    const input = (Array.isArray(a.links) ? a.links : [])
      .map((l: unknown) => (typeof l === 'string' ? { url: l } : (l as { url?: string; note?: string })))
      .filter((l: { url?: string }) => typeof l?.url === 'string')
      .slice(0, 8) as { url: string; note?: string }[];
    if (!input.length) return 'Give at least one link.';
    const items = await Promise.all(input.map(async (l) => ({ ...(await previewLink(l.url, ctx.signal)), note: clean(l.note, 120) })));
    const card: Card = { type: 'links', title: clean(a.title, 80), items };
    const lines = items.map((i) => `- ${i.title} (${i.site})${i.price ? ` · ${i.price}` : ''}${i.ok ? '' : ' · preview unavailable'}`);
    return { content: untrusted('link previews', `Shown to the user as cards:\n${lines.join('\n')}`), cards: [card] };
  },
});

registerTool({
  name: 'show_images',
  label: 'Show images',
  group: 'Web',
  description:
    'Show pictures from the web to the user, inline where you call it (e.g. a product photo, a diagram, a place). Give direct image URLs you found in pages or search results; each one is checked to really be an image before it is shown. For images in the workspace use show_file.',
  parameters: {
    type: 'object',
    properties: {
      images: {
        type: 'array',
        description: 'Up to 8 images',
        items: { type: 'object', properties: { url: { type: 'string' }, caption: { type: 'string' }, source: { type: 'string', description: 'Page the image comes from, linked under it' } }, required: ['url'] },
      },
    },
    required: ['images'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Show ${(a.images ?? []).length} image${(a.images ?? []).length === 1 ? '' : 's'}`,
  async run(a, ctx) {
    const input = (Array.isArray(a.images) ? a.images : []).slice(0, 8) as { url?: string; caption?: string; source?: string }[];
    const shown: { url: string; caption?: string; source?: string; site: string }[] = [];
    const skipped: string[] = [];
    await Promise.all(
      input.map(async (img) => {
        const url = pictureUrl(String(img.url ?? ''), 'https://invalid/');
        if (!url) return skipped.push(`${img.url} (not an https address)`);
        if (blocked(url)) return skipped.push(`${img.url} (blocked domain)`);
        try {
          const res = await agentFetch(url, { headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' } }, AbortSignal.any([AbortSignal.timeout(10_000), ...(ctx.signal ? [ctx.signal] : [])]));
          await res.body?.cancel().catch(() => {});
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok) return skipped.push(`${img.url} (HTTP ${res.status})`);
          if (!/^image\/(png|jpeg|gif|webp|avif)/i.test(type)) return skipped.push(`${img.url} (not a picture: ${type.split(';')[0] || 'unknown type'})`);
          const source = img.source && /^https?:\/\//i.test(img.source) ? img.source : undefined;
          shown.push({ url: res.url || url, caption: clean(img.caption, 140), source, site: host(source ?? url) });
        } catch (err) {
          if (ctx.signal?.aborted) throw err;
          skipped.push(`${img.url} (${errorMessage(err)})`);
        }
      }),
    );
    // Keep the order the agent asked for.
    shown.sort((x, y) => input.findIndex((i) => pictureUrl(String(i.url), 'https://invalid/') === x.url) - input.findIndex((i) => pictureUrl(String(i.url), 'https://invalid/') === y.url));
    return {
      content: `${shown.length ? `Shown ${shown.length} image${shown.length === 1 ? '' : 's'}.` : 'No images shown.'}${skipped.length ? ` Not images or unreachable: ${skipped.join(', ')}` : ''}`,
      cards: shown.length ? [{ type: 'images', items: shown }] : [],
    };
  },
});
