import crypto from 'node:crypto';
import { all, get, run } from './db.js';
import { emit } from './events.js';
import { cosine, embedDocuments, embedModelName } from './agent/helpers.js';
import { redact } from './safety.js';
import { getSettings } from './settings.js';
import { id, now, truncate } from './util.js';

/**
 * The Library: Sable's shared store. Every chat, sub-agent and Space can search it without asking.
 * Two halves (docs/research/library.md):
 *   open    — anything without personal details or secrets (web pages, general notes, how-tos)
 *   private — secrets, personal details, people, messages, memories, what Sable did for you.
 *             Shown in full to local models; to cloud models only with personal details redacted.
 * Search is hybrid: SQLite FTS5 keywords + embeddings (when the helper model is available), merged
 * with reciprocal rank fusion.
 */

export type LibKind = 'note' | 'page' | 'file' | 'output' | 'upload' | 'person' | 'action';
export type Privacy = 'open' | 'private';
export type Trust = 'owner' | 'agent' | 'external';

export interface LibItem {
  id: string;
  kind: LibKind;
  title: string;
  summary: string | null;
  body: string;
  source: string;
  source_ref: string | null;
  url: string | null;
  conversation_id: string | null;
  trust: Trust;
  privacy: Privacy;
  privacy_reason: string | null;
  privacy_locked: number;
  status: 'pending' | 'ready' | 'error';
  hash: string;
  created_at: number;
  updated_at: number;
}

// ───────────── Privacy classification ─────────────

const PERSONAL: [RegExp, string][] = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'an email address'],
  [/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, 'a phone number'],
  [/\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Pkwy|Cir|Circle)\b\.?/g, 'a street address'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, 'an ID number'],
  [/\b(?:\d[ -]?){13,19}\b/g, 'a card-like number'],
];
const SECRETISH = /\[REDACTED\]|-----BEGIN [A-Z ]*PRIVATE KEY|\b(password|passwd|api[_-]?key|secret|token)\s*[:=]/i;

/** Decide open vs private. When in doubt, private. */
export function classify(text: string, hint: { kind: LibKind; source: string }): { privacy: Privacy; reason: string | null } {
  if (hint.kind === 'person' || hint.kind === 'action') return { privacy: 'private', reason: hint.kind === 'person' ? 'about a person in your life' : 'something Sable did for you' };
  if (hint.kind === 'upload') return { privacy: 'private', reason: 'a file you uploaded' };
  if (SECRETISH.test(text) || redact(text) !== text) return { privacy: 'private', reason: 'looks like it contains a secret' };
  const found = PERSONAL.filter(([re]) => {
    re.lastIndex = 0;
    return re.test(text);
  }).map(([, what]) => what);
  if (found.length) return { privacy: 'private', reason: `contains ${found.slice(0, 2).join(' and ')}` };
  return { privacy: 'open', reason: null };
}

/** Private text for a cloud model: secrets and personal details replaced. */
export function redactPersonal(text: string): string {
  let out = redact(text);
  for (const [re] of PERSONAL) out = out.replace(re, '[private]');
  return out;
}

/** Is the main model running on hardware you control (so private content can be shown in full)? */
export function mainModelIsLocal(): boolean {
  const s = getSettings();
  const p = s.providers.find((x) => x.id === s.main.providerId);
  if (!p) return false;
  if (/(^|[:-])cloud$/i.test(s.main.model)) return false; // Ollama cloud models
  if (p.type === 'ollama' || p.type === 'llamacpp') return true;
  if (p.type === 'openai-compatible' && p.baseUrl) {
    try {
      const h = new URL(p.baseUrl).hostname;
      return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h) || h.endsWith('.ts.net') || h.endsWith('.local');
    } catch {
      return false;
    }
  }
  return false;
}

// ───────────── Storage ─────────────

const hashOf = (s: string) => crypto.createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex');

/** Split into ~1,200-character chunks along headings and paragraphs, with a little overlap. */
export function chunk(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const blocks = clean.split(/\n(?=#{1,6}\s)|\n{2,}/);
  const out: string[] = [];
  let cur = '';
  for (const b of blocks) {
    if (cur && cur.length + b.length + 2 > size) {
      out.push(cur.trim());
      cur = cur.slice(-overlap);
    }
    if (b.length > size) {
      for (let i = 0; i < b.length; i += size - overlap) out.push(b.slice(i, i + size).trim());
      cur = '';
    } else cur += (cur ? '\n\n' : '') + b;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export interface AddInput {
  kind: LibKind;
  title: string;
  body: string;
  source: string;
  sourceRef?: string;
  url?: string;
  conversationId?: string;
  trust: Trust;
  /** Force a privacy level (the user's choice); otherwise classified. */
  privacy?: Privacy;
  summary?: string;
}

/** Add (or refresh) an item. Same content from the same place isn't stored twice. Indexing happens in the background. */
export function addItem(input: AddInput): LibItem {
  const body = input.body.slice(0, 400_000);
  const hash = hashOf(`${input.url ?? ''}\n${body}`);
  const existing = get<LibItem>('SELECT * FROM lib_items WHERE hash = ?', hash);
  if (existing) {
    run('UPDATE lib_items SET updated_at = ? WHERE id = ?', now(), existing.id);
    return existing;
  }
  // A page fetched again with new content replaces the old copy.
  if (input.url) {
    const old = get<{ id: string }>('SELECT id FROM lib_items WHERE url = ? AND kind = ?', input.url, input.kind);
    if (old) forgetItem(old.id, false);
  }
  const c = input.privacy ? { privacy: input.privacy, reason: 'set by you' } : classify(`${input.title}\n${body}`, input);
  const item: LibItem = {
    id: id('lib_'),
    kind: input.kind,
    title: input.title.slice(0, 200) || 'Untitled',
    summary: input.summary ?? null,
    body,
    source: input.source,
    source_ref: input.sourceRef ?? null,
    url: input.url ?? null,
    conversation_id: input.conversationId ?? null,
    trust: input.trust,
    privacy: c.privacy,
    privacy_reason: c.reason,
    privacy_locked: input.privacy ? 1 : 0,
    status: 'pending',
    hash,
    created_at: now(),
    updated_at: now(),
  };
  run(
    `INSERT INTO lib_items (id, kind, title, summary, body, source, source_ref, url, conversation_id, trust, privacy, privacy_reason, privacy_locked, status, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id, item.kind, item.title, item.summary, item.body, item.source, item.source_ref, item.url, item.conversation_id, item.trust, item.privacy, item.privacy_reason, item.privacy_locked, item.status, item.hash, item.created_at, item.updated_at,
  );
  // Keyword search works right away; embeddings follow in the background.
  chunk(`${item.title}\n\n${body}`).forEach((text, seq) => {
    const cid = id('chk_');
    run('INSERT INTO lib_chunks (id, item_id, seq, text) VALUES (?, ?, ?, ?)', cid, item.id, seq, text);
    run('INSERT INTO lib_fts (rowid, text, chunk_id) VALUES ((SELECT rowid FROM lib_chunks WHERE id = ?), ?, ?)', cid, text, cid);
  });
  emit({ type: 'library.changed' });
  queueIndex();
  return item;
}

export function getItem(itemId: string) {
  return get<LibItem>('SELECT * FROM lib_items WHERE id = ?', itemId);
}

export function setPrivacy(itemId: string, privacy: Privacy) {
  run("UPDATE lib_items SET privacy = ?, privacy_reason = 'set by you', privacy_locked = 1, updated_at = ? WHERE id = ?", privacy, now(), itemId);
  emit({ type: 'library.changed' });
}

/** Forget really forgets: the item, its chunks, keyword index and vectors. A hash stays so it isn't re-imported. */
export function forgetItem(itemId: string, tombstone = true) {
  const item = getItem(itemId);
  if (!item) return false;
  for (const c of all<{ id: string; rowid: number }>('SELECT id, rowid FROM lib_chunks WHERE item_id = ?', itemId)) {
    run('DELETE FROM lib_fts WHERE rowid = ?', c.rowid);
    run('DELETE FROM lib_vec WHERE chunk_id = ?', c.id);
  }
  run('DELETE FROM lib_chunks WHERE item_id = ?', itemId);
  run('DELETE FROM lib_items WHERE id = ?', itemId);
  if (tombstone) run('INSERT OR IGNORE INTO lib_forgotten (hash, at) VALUES (?, ?)', item.hash, now());
  emit({ type: 'library.changed' });
  return true;
}

export function wasForgotten(body: string, url?: string) {
  return !!get('SELECT 1 FROM lib_forgotten WHERE hash = ?', hashOf(`${url ?? ''}\n${body}`));
}

// ───────────── Background indexing (embeddings) ─────────────

let indexing = false;
let queued = false;

export function queueIndex() {
  if (indexing) {
    queued = true;
    return;
  }
  setTimeout(() => void indexPending(), 200);
}

const toBlob = (v: number[]) => Buffer.from(new Float32Array(v).buffer);
const fromBlob = (b: Uint8Array) => Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));

async function indexPending() {
  indexing = true;
  try {
    const model = embedModelName();
    for (let round = 0; round < 50; round++) {
      const chunks = all<{ id: string; text: string; item_id: string }>(
        'SELECT c.id, c.text, c.item_id FROM lib_chunks c WHERE NOT EXISTS (SELECT 1 FROM lib_vec v WHERE v.chunk_id = c.id AND v.model = ?) LIMIT 64',
        model,
      );
      if (!chunks.length) break;
      const vecs = await embedDocuments(chunks.map((c) => c.text));
      if (!vecs) break; // helper model not available: keyword search still works
      chunks.forEach((c, i) => run('INSERT OR REPLACE INTO lib_vec (chunk_id, model, dim, vec) VALUES (?, ?, ?, ?)', c.id, model, vecs[i].length, toBlob(vecs[i])));
    }
    run("UPDATE lib_items SET status = 'ready' WHERE status = 'pending'");
  } finally {
    indexing = false;
    if (queued) {
      queued = false;
      queueIndex();
    }
  }
}

// ───────────── Search ─────────────

export interface Hit {
  item: LibItem;
  chunk: string;
  score: number;
}

/** Turn free text into a safe FTS5 query: words OR'ed, prefix match on longer words. */
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those my me i you your we our can could would should please what how did do does from at by as about into just get got have has had when where which who why will not no'.split(' '));
function ftsQuery(q: string) {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w));
  return [...new Set(words)].slice(0, 16).map((w) => (w.length > 3 ? `"${w}"*` : `"${w}"`)).join(' OR ');
}

export async function search(query: string, opts: { kinds?: LibKind[]; privacy?: Privacy; conversationId?: string; limit?: number } = {}): Promise<Hit[]> {
  const limit = Math.min(opts.limit ?? 8, 30);
  const filter = (it: LibItem) => (!opts.kinds?.length || opts.kinds.includes(it.kind)) && (!opts.privacy || it.privacy === opts.privacy) && (!opts.conversationId || it.conversation_id === opts.conversationId);
  const ranks = new Map<string, { rrf: number; text: string; itemId: string }>();
  const addRank = (chunkId: string, itemId: string, text: string, rank: number) => {
    const cur = ranks.get(chunkId) ?? { rrf: 0, text, itemId };
    cur.rrf += 1 / (60 + rank);
    ranks.set(chunkId, cur);
  };
  const fq = ftsQuery(query);
  if (fq) {
    const rows = all<{ chunk_id: string; text: string; item_id: string }>(
      'SELECT f.chunk_id, c.text, c.item_id FROM lib_fts f JOIN lib_chunks c ON c.id = f.chunk_id WHERE lib_fts MATCH ? ORDER BY bm25(lib_fts) LIMIT 60',
      fq,
    );
    rows.forEach((r, i) => addRank(r.chunk_id, r.item_id, r.text, i));
  }
  const qv = (await embedDocuments([query], 'query'))?.[0];
  if (qv) {
    const model = embedModelName();
    const scored: { id: string; item: string; text: string; s: number }[] = [];
    for (const r of all<{ chunk_id: string; vec: Uint8Array; text: string; item_id: string }>(
      'SELECT v.chunk_id, v.vec, c.text, c.item_id FROM lib_vec v JOIN lib_chunks c ON c.id = v.chunk_id WHERE v.model = ?',
      model,
    )) {
      scored.push({ id: r.chunk_id, item: r.item_id, text: r.text, s: cosine(qv, fromBlob(r.vec)) });
    }
    scored.sort((a, b) => b.s - a.s);
    scored.slice(0, 60).filter((x) => x.s > 0.3).forEach((x, i) => addRank(x.id, x.item, x.text, i));
  }
  const best = new Map<string, Hit>();
  for (const [, r] of [...ranks].sort((a, b) => b[1].rrf - a[1].rrf)) {
    if (best.has(r.itemId)) continue;
    const item = getItem(r.itemId);
    if (!item || !filter(item)) continue;
    best.set(r.itemId, { item, chunk: r.text, score: r.rrf });
    if (best.size >= limit) break;
  }
  return [...best.values()];
}

/** How an item is shown to the model: private content redacted for cloud models; external content marked. */
export function forModel(item: LibItem, text: string) {
  const shown = item.privacy === 'private' && !mainModelIsLocal() ? redactPersonal(text) : text;
  return item.trust === 'external' ? `<untrusted source="library: ${item.url ?? item.source}">\n${shown}\n</untrusted>` : shown;
}

export function listItems(opts: { kind?: string; privacy?: string; q?: string; limit?: number; before?: number }) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.kind) (where.push('kind = ?'), args.push(opts.kind));
  if (opts.privacy) (where.push('privacy = ?'), args.push(opts.privacy));
  if (opts.before) (where.push('updated_at < ?'), args.push(opts.before));
  if (opts.q) (where.push('(title LIKE ? OR body LIKE ?)'), args.push(`%${opts.q}%`, `%${opts.q}%`));
  return all<LibItem>(
    `SELECT id, kind, title, summary, substr(body, 1, 400) AS body, source, source_ref, url, conversation_id, trust, privacy, privacy_reason, privacy_locked, status, hash, created_at, updated_at FROM lib_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`,
    ...args,
    Math.min(opts.limit ?? 60, 200),
  );
}

export function libraryStats() {
  const r = get<{ items: number; open: number; private: number }>("SELECT count(*) items, sum(privacy = 'open') open, sum(privacy = 'private') private FROM lib_items");
  const chunks = get<{ n: number }>('SELECT count(*) n FROM lib_chunks')?.n ?? 0;
  const vectors = get<{ n: number }>('SELECT count(*) n FROM lib_vec WHERE model = ?', embedModelName())?.n ?? 0;
  return { items: r?.items ?? 0, open: r?.open ?? 0, private: r?.private ?? 0, chunks, vectors, model: embedModelName() };
}

export const libSnippet = (t: string, n = 600) => truncate(t.replace(/\s+/g, ' ').trim(), n);
