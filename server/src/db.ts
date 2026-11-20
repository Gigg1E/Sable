import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'sable.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'chat',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id TEXT, role TEXT NOT NULL, agent TEXT, content TEXT NOT NULL DEFAULT '',
  thinking TEXT, tool_calls TEXT, tool_call_id TEXT, tool_name TEXT, is_error INTEGER DEFAULT 0,
  raw TEXT, raw_model TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user', model TEXT, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, run_id TEXT, conversation_id TEXT, call_id TEXT, agent TEXT, tool TEXT NOT NULL,
  args TEXT NOT NULL, summary TEXT, risk TEXT, scope TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, conversation_id TEXT, run_id TEXT, agent TEXT,
  tool TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, input TEXT, output TEXT, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS activity_ts ON activity(ts);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, content TEXT NOT NULL, source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '[]', conversation_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, icon TEXT, html TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}', pinned INTEGER NOT NULL DEFAULT 0, conversation_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL, kind TEXT NOT NULL, spec TEXT NOT NULL,
  next_run INTEGER, last_run INTEGER, enabled INTEGER NOT NULL DEFAULT 1, conversation_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, task TEXT NOT NULL,
  background INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, steps TEXT, result TEXT, model TEXT,
  created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS agent_jobs_c ON agent_jobs(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS lib_items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, body TEXT NOT NULL, source TEXT NOT NULL,
  source_ref TEXT, url TEXT, conversation_id TEXT, trust TEXT NOT NULL, privacy TEXT NOT NULL, privacy_reason TEXT,
  privacy_locked INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lib_items_hash ON lib_items(hash);
CREATE INDEX IF NOT EXISTS lib_items_updated ON lib_items(updated_at);
CREATE TABLE IF NOT EXISTS lib_chunks (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, seq INTEGER NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lib_chunks_item ON lib_chunks(item_id);
CREATE VIRTUAL TABLE IF NOT EXISTS lib_fts USING fts5(text, chunk_id UNINDEXED, tokenize = 'porter unicode61');
CREATE TABLE IF NOT EXISTS lib_vec (chunk_id TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (chunk_id, model));
CREATE TABLE IF NOT EXISTS lib_forgotten (hash TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'person', relation TEXT, aliases TEXT, contacts TEXT,
  preferred TEXT, notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, note TEXT, due_at INTEGER NOT NULL, conversation_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watchers (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, extract TEXT NOT NULL, condition TEXT NOT NULL,
  actions TEXT NOT NULL, interval_min INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  last_value TEXT, last_numeric REAL, last_checked INTEGER, last_changed INTEGER, last_triggered INTEGER,
  last_error TEXT, fail_count INTEGER NOT NULL DEFAULT 0, next_check INTEGER, conversation_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, watcher_id TEXT NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL, value TEXT, numeric REAL, triggered INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX IF NOT EXISTS watch_history_w ON watch_history(watcher_id, ts);
CREATE TABLE IF NOT EXISTS hooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL, verify TEXT NOT NULL DEFAULT 'none', secret TEXT,
  action TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_received INTEGER, count INTEGER NOT NULL DEFAULT 0,
  conversation_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hook_events (
  id TEXT PRIMARY KEY, hook_id TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE, ts INTEGER NOT NULL,
  method TEXT, headers TEXT, body TEXT, delivery_id TEXT, status TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS hook_events_h ON hook_events(hook_id, ts);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER, height INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  name TEXT PRIMARY KEY, base_url TEXT NOT NULL, auth TEXT NOT NULL, read_methods TEXT NOT NULL, purpose TEXT NOT NULL,
  credential_help TEXT, secret_enc TEXT, created_at INTEGER NOT NULL, last_used INTEGER
);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, link TEXT, kind TEXT,
  read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
`);

// Columns added after the first release (existing databases are upgraded in place).
function addColumn(table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('messages', 'attachments', 'TEXT');
addColumn('approvals', 'call_id', 'TEXT');
addColumn('messages', 'cards', 'TEXT');
addColumn('approvals', 'preview', 'TEXT');
addColumn('uploads', 'name', 'TEXT');
addColumn('uploads', 'path', 'TEXT');
addColumn('schedules', 'notify', 'TEXT');
addColumn('schedules', 'last_result', 'TEXT');
addColumn('schedules', 'autonomy', 'TEXT');
addColumn('schedules', 'restrict_tools', 'TEXT');
addColumn('watchers', 'source', "TEXT NOT NULL DEFAULT 'web'");
addColumn('watchers', 'source_config', 'TEXT');
addColumn('watchers', 'state', 'TEXT');
addColumn('watchers', 'autonomy', 'TEXT');
addColumn('watchers', 'restrict_tools', 'TEXT');
addColumn('watchers', 'run_conversation_id', 'TEXT');
addColumn('memories', 'kind', "TEXT NOT NULL DEFAULT 'me'");
addColumn('memories', 'embedding', 'TEXT');
addColumn('spaces', 'theme', 'TEXT');
addColumn('conversations', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
addColumn('agent_jobs', 'outcome', 'TEXT');
addColumn('activity', 'prev_hash', 'TEXT');
addColumn('activity', 'hash', 'TEXT');
addColumn('agent_jobs', 'transcript', 'TEXT');

type Row = Record<string, unknown>;

export function all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function kvGet<T>(key: string): T | undefined {
  const row = get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : undefined;
}
export function kvDel(key: string) {
  run('DELETE FROM kv WHERE key = ?', key);
}
export function kvSet(key: string, value: unknown) {
  run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
