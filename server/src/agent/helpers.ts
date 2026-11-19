import { emit } from '../events.js';
import { getSettings } from '../settings.js';
import { errorMessage } from '../util.js';

/**
 * Helper models: a small embedding model on Ollama, used to pick which tools and memories are
 * relevant to a message. Installed automatically when Ollama is reachable; everything falls back
 * to keyword matching when it isn't.
 */

export interface HelperStatus {
  ollama: boolean;
  model: string;
  installed: boolean;
  pulling: boolean;
  progress?: string;
  error?: string;
}

const status: HelperStatus = { ollama: false, model: '', installed: false, pulling: false };
export const helperStatus = () => ({ ...status, enabled: helperSettings().enabled });

export function helperSettings() {
  const h = getSettings().helpers ?? { enabled: true, embedModel: 'embeddinggemma' };
  return { enabled: h.enabled !== false, embedModel: h.embedModel || 'embeddinggemma' };
}

function ollamaBase(): string | null {
  const p = getSettings().providers.find((x) => x.type === 'ollama' && x.baseUrl);
  return p?.baseUrl?.replace(/\/+$/, '') ?? null;
}

const changed = () => emit({ type: 'helpers.changed', status: helperStatus() });

/** Check Ollama and pull the embedding model if it's missing. Safe to call often. */
export async function ensureHelpers(force = false) {
  const base = ollamaBase();
  const { enabled, embedModel } = helperSettings();
  status.model = embedModel;
  if (!base || !enabled || status.pulling) return helperStatus();
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const tags = (await res.json()) as { models?: { name: string }[] };
    status.ollama = true;
    status.installed = (tags.models ?? []).some((m) => m.name === embedModel || m.name.startsWith(`${embedModel}:`));
    status.error = undefined;
  } catch {
    status.ollama = false;
    status.installed = false;
    changed();
    return helperStatus();
  }
  if (!status.installed && (force || !status.error)) void pull(base, embedModel);
  changed();
  return helperStatus();
}

async function pull(base: string, model: string) {
  status.pulling = true;
  status.progress = 'starting';
  changed();
  try {
    const res = await fetch(`${base}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
    if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
        if (ev.error) throw new Error(ev.error);
        status.progress = ev.total ? `${ev.status} ${Math.round(((ev.completed ?? 0) / ev.total) * 100)}%` : ev.status;
        if (Date.now() - last > 1000) {
          last = Date.now();
          changed();
        }
      }
    }
    status.installed = true;
    status.progress = undefined;
  } catch (err) {
    status.error = `Couldn't install ${model}: ${errorMessage(err)}`;
  } finally {
    status.pulling = false;
    changed();
  }
}

export function startHelpers() {
  setTimeout(() => void ensureHelpers(), 4000).unref?.();
  setInterval(() => void ensureHelpers(), 30 * 60_000).unref?.();
}

// ───────────── Embeddings ─────────────

const cache = new Map<string, number[]>();

/** Embed texts with the helper model; null when it isn't available (callers fall back to keywords). */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const base = ollamaBase();
  const { enabled, embedModel } = helperSettings();
  if (!base || !enabled || !status.installed || !texts.length) return null;
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length) {
    try {
      const res = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embedModel, input: missing.map((t) => t.slice(0, 2000)) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { embeddings?: number[][] };
      if (!data.embeddings || data.embeddings.length !== missing.length) return null;
      missing.forEach((t, i) => cache.set(t, data.embeddings![i]));
      if (cache.size > 4000) for (const k of [...cache.keys()].slice(0, 1000)) cache.delete(k);
    } catch {
      return null;
    }
  }
  return texts.map((t) => cache.get(t)!);
}

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const STOP = new Set('the a an and or of to in on for with is are be it this that my me i you your can please what how do does from at by as about into just'.split(' '));
export const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
/** Keyword overlap score (fallback when embeddings aren't available). */
export function overlap(query: Set<string>, text: string) {
  const t = words(text);
  let n = 0;
  for (const w of query) if (t.has(w) || [...t].some((x) => x.startsWith(w) || w.startsWith(x))) n++;
  return n;
}
