import { all, get, kvGet, kvSet, run } from './db.js';
import { emit } from './events.js';
import { getSettings } from './settings.js';
import { errorMessage, id, now, truncate } from './util.js';

/**
 * The main brain (docs/design/core-concepts.md §1):
 *  - one permanent main chat, the app's home, where Sable keeps the big picture;
 *  - a journal: what happened, decisions, and open loops (things promised, by Sable or by you);
 *  - digests: when a topic chat goes quiet, one or two lines about it land in the journal;
 *  - rolling summaries: long chats fold their older part into a summary instead of forgetting it.
 */

// ───────────── The main chat ─────────────

export function mainConversationId(): string {
  const cid = kvGet<string>('main_conversation');
  if (cid && get('SELECT id FROM conversations WHERE id = ?', cid)) return cid;
  const fresh = id('c_');
  run("INSERT INTO conversations (id, title, kind, created_at, updated_at, pinned) VALUES (?, ?, 'main', ?, ?, 1)", fresh, getSettings().persona.name || 'Sable', now(), now());
  kvSet('main_conversation', fresh);
  emit({ type: 'conversation.changed', id: fresh });
  return fresh;
}

export function isMain(conversationId: string) {
  return kvGet<string>('main_conversation') === conversationId;
}

// ───────────── Journal ─────────────

export type JournalKind = 'note' | 'decision' | 'open_loop' | 'digest' | 'event';
export interface JournalEntry {
  id: string;
  ts: number;
  day: string;
  kind: JournalKind;
  text: string;
  status: 'open' | 'done';
  conversation_id: string | null;
  closed_at: number | null;
}

const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function journalAdd(kind: JournalKind, text: string, conversationId?: string | null): JournalEntry {
  const e: JournalEntry = { id: id('jr_'), ts: now(), day: dayOf(now()), kind, text: truncate(text.trim(), 600), status: 'open', conversation_id: conversationId ?? null, closed_at: null };
  run('INSERT INTO journal (id, ts, day, kind, text, status, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?)', e.id, e.ts, e.day, e.kind, e.text, e.status, e.conversation_id);
  emit({ type: 'journal.changed' });
  return e;
}

export function journalClose(jid: string, done = true) {
  const ok = run('UPDATE journal SET status = ?, closed_at = ? WHERE id = ?', done ? 'done' : 'open', done ? now() : null, jid).changes > 0;
  if (ok) emit({ type: 'journal.changed' });
  return ok;
}

export function journalDelete(jid: string) {
  const ok = run('DELETE FROM journal WHERE id = ?', jid).changes > 0;
  if (ok) emit({ type: 'journal.changed' });
  return ok;
}

export function journalRecent(days = 7): JournalEntry[] {
  return all<JournalEntry>('SELECT * FROM journal WHERE ts > ? ORDER BY ts DESC LIMIT 200', now() - days * 86_400_000);
}

export function openLoops(): JournalEntry[] {
  return all<JournalEntry>("SELECT * FROM journal WHERE kind = 'open_loop' AND status = 'open' ORDER BY ts LIMIT 50");
}

/** What the main chat sees every turn: open loops, then the recent journal by day. */
export function journalForPrompt(): string {
  const loops = openLoops();
  const recent = journalRecent(7).filter((e) => e.kind !== 'open_loop').slice(0, 40);
  const parts: string[] = [];
  parts.push(loops.length ? `Open loops (close with journal_close when done):\n${loops.map((l) => `- [${l.id}] ${l.text} (since ${l.day})`).join('\n')}` : 'Open loops: none');
  if (recent.length) {
    const byDay = new Map<string, JournalEntry[]>();
    for (const e of recent) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
    parts.push(
      `Journal, last 7 days:\n${[...byDay]
        .map(([day, es]) => `${day}\n${es.map((e) => `- ${e.kind === 'digest' ? 'From a topic chat: ' : e.kind === 'decision' ? 'Decided: ' : ''}${e.text}`).join('\n')}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

// ───────────── Rolling summaries ─────────────

let quick: ((system: string, prompt: string, signal?: AbortSignal) => Promise<string>) | null = null;
/** runner.ts hands its quickAnswer in (avoids an import cycle). */
export function setQuickAnswer(f: typeof quick) {
  quick = f;
}

const summarizing = new Set<string>();

/**
 * After a turn: if a chat has grown well past what fits in context, fold its oldest part into the
 * running summary, so long chats (above all the main chat) never just forget their beginning.
 */
export async function maybeSummarize(conversationId: string) {
  if (!quick || summarizing.has(conversationId)) return;
  const limit = getSettings().main.contextMessages || 80;
  const conv = get<{ summary: string | null; summary_upto: number | null }>('SELECT summary, summary_upto FROM conversations WHERE id = ?', conversationId);
  if (!conv) return;
  const rows = all<{ rowid: number; role: string; content: string; tool_name: string | null }>(
    "SELECT rowid, role, content, tool_name FROM messages WHERE conversation_id = ? AND rowid > ? AND role IN ('user','assistant','tool') ORDER BY rowid",
    conversationId,
    conv.summary_upto ?? 0,
  );
  if (rows.length < limit + 20) return;
  // Fold everything except the most recent half-window, cutting just before a user message.
  let cut = rows.length - Math.floor(limit / 2);
  while (cut > 0 && rows[cut].role !== 'user') cut--;
  if (cut < 10) return;
  const fold = rows.slice(0, cut);
  summarizing.add(conversationId);
  try {
    const transcript = fold
      .map((m) => (m.role === 'tool' ? `[${m.tool_name} result] ${truncate(m.content, 300)}` : `${m.role === 'user' ? 'User' : 'Sable'}: ${truncate(m.content, 1500)}`))
      .join('\n')
      .slice(-60_000);
    const text = await quick(
      'You maintain the running summary of a long conversation between a user and their assistant, Sable. Merge the previous summary with the new part. Keep: facts about the user, decisions, what was done (and where files or results are), promises and open loops, preferences, and anything the conversation keeps referring to. Drop chit-chat and tool noise. Write plain prose and short lists, at most about 400 words. Do not invent anything.',
      `${conv.summary ? `Previous summary:\n${conv.summary}\n\n` : ''}New part of the conversation:\n${transcript}`,
      AbortSignal.timeout(120_000),
    );
    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (clean) run('UPDATE conversations SET summary = ?, summary_upto = ? WHERE id = ?', clean, fold[fold.length - 1].rowid, conversationId);
  } catch (err) {
    console.error('[summary]', errorMessage(err));
  } finally {
    summarizing.delete(conversationId);
  }
}

// ───────────── Digests from topic chats ─────────────

/** Topic chats that went quiet get a one- or two-line digest in the journal, so the main brain knows. */
export async function digestQuietChats() {
  if (!quick || !kvGet<string>('main_conversation')) return;
  const quietFor = 30 * 60_000;
  const chats = all<{ id: string; title: string; digest_at: number | null; updated_at: number }>(
    "SELECT id, title, digest_at, updated_at FROM conversations WHERE kind = 'chat' AND updated_at < ? AND updated_at > COALESCE(digest_at, 0) ORDER BY updated_at DESC LIMIT 3",
    now() - quietFor,
  );
  for (const c of chats) {
    const msgs = all<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user','assistant') AND created_at > ? AND content != '' ORDER BY rowid",
      c.id,
      c.digest_at ?? 0,
    );
    run('UPDATE conversations SET digest_at = ? WHERE id = ?', now(), c.id);
    if (msgs.length < 2) continue;
    try {
      const text = await quick(
        "Write a digest of this chat for the assistant's journal: one or two short sentences saying what was done or decided and what is still open. Start with the topic. No preamble. If nothing meaningful happened, reply exactly: nothing",
        `Chat "${c.title}":\n${msgs.map((m) => `${m.role === 'user' ? 'User' : 'Sable'}: ${truncate(m.content, 800)}`).join('\n').slice(-20_000)}`,
        AbortSignal.timeout(90_000),
      );
      const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (clean && !/^nothing\.?$/i.test(clean)) journalAdd('digest', clean, c.id);
    } catch (err) {
      console.error('[digest]', errorMessage(err));
    }
  }
}

export function startBrain() {
  mainConversationId();
  setInterval(() => void digestQuietChats(), 5 * 60_000).unref();
  setTimeout(() => void digestQuietChats(), 60_000).unref();
}
