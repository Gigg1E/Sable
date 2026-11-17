import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type express from 'express';
import fsSync from 'node:fs';
import { chatDir, WORKSPACE_DIR } from '../../config.js';
import { kvGet, kvSet, run as dbRun } from '../../db.js';
import { emit } from '../../events.js';
import { looksText } from '../../uploads.js';
import { proxyEnv } from '../../net.js';
import { getSettings } from '../../settings.js';
import { id, truncate } from '../../util.js';
import { registerTool, type Card } from './registry.js';

/** Resolve a model-supplied path inside the workspace, refusing anything that escapes it. */
async function safePath(p: string): Promise<string> {
  const root = await fs.realpath(WORKSPACE_DIR);
  const target = path.resolve(root, String(p ?? '.').replace(/^\/+/, ''));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path is outside the workspace.');
  // Follow symlinks for existing paths so a link can't point outside.
  try {
    const real = await fs.realpath(target);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Path is outside the workspace.');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return target;
}

// ───────────── Per-chat folders ─────────────
// Every chat works in workspace/chats/<chat id>/ (the id never changes, so renaming a chat loses nothing).
// workspace/shared/ is for things meant to be reused across chats. Files saved under outputs/ are
// handed to the user automatically.

/** One-time move of the old flat workspace into shared/. */
(function migrateWorkspace() {
  try {
    if (kvGet<string>('workspace_layout') === 'chats') return;
    const shared = path.join(WORKSPACE_DIR, 'shared');
    const legacy = fsSync.readdirSync(WORKSPACE_DIR).filter((n) => !['chats', 'shared', '.staging', '.scripts'].includes(n));
    if (legacy.length) {
      fsSync.mkdirSync(shared, { recursive: true });
      for (const n of legacy) {
        let dest = path.join(shared, n);
        for (let i = 2; fsSync.existsSync(dest); i++) dest = path.join(shared, `${n} (${i})`);
        fsSync.renameSync(path.join(WORKSPACE_DIR, n), dest);
      }
      dbRun("UPDATE uploads SET path = 'shared/' || path WHERE path IS NOT NULL AND path NOT LIKE 'chats/%' AND path NOT LIKE 'shared/%' AND path NOT LIKE '.staging/%'");
    }
    kvSet('workspace_layout', 'chats');
  } catch (err) {
    console.error('Workspace migration failed:', err);
  }
})();

/** A path the model gave → workspace-relative path inside this chat's folder (or shared/). */
function chatRel(conversationId: string, p: unknown): string {
  const q = String(p ?? '.').trim().replace(/^(file|sandbox|attachment):\/*/i, '').replace(/^\/+/, '').replace(/^(mnt\/data|workspace)\//i, '') || '.';
  const home = chatDir(conversationId);
  const norm = path.posix.normalize(/^shared(\/|$)/.test(q) ? q : `${home}/${q}`).replace(/\/$/, '');
  const inside = norm === home || norm.startsWith(home + '/') || norm === 'shared' || norm.startsWith('shared/');
  if (!inside) throw new Error(`"${p}" is outside this chat's folder. Use paths like "notes.md", "outputs/report.docx" or "shared/…".`);
  return norm;
}

/** Absolute path for a model-supplied path in this chat, creating the chat folder on first use. */
export async function chatPath(conversationId: string, p: unknown): Promise<string> {
  await fs.mkdir(path.join(WORKSPACE_DIR, chatDir(conversationId), 'outputs'), { recursive: true });
  return safePath(chatRel(conversationId, p));
}

/** Workspace-relative path → how the model and the user see it inside the chat. */
export const chatView = (conversationId: string, wrel: string) => (wrel.startsWith(chatDir(conversationId) + '/') ? wrel.slice(chatDir(conversationId).length + 1) : wrel);
const isOutput = (conversationId: string, wrel: string) => wrel.startsWith(chatDir(conversationId) + '/outputs/');

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf', csv: 'text/csv', md: 'text/markdown', txt: 'text/plain', json: 'application/json', html: 'text/html', htm: 'text/html',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4',
};
export const mimeOf = (p: string) => MIME[path.extname(p).slice(1).toLowerCase()] ?? (looksText(p, '') ? 'text/plain' : 'application/octet-stream');
/** Raster images that are safe to show inline (SVG can carry scripts, so it only downloads). */
const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp|avif)$/;

const rel = (abs: string, root: string) => path.relative(root, abs).split(path.sep).join('/');

/** A card that shows a workspace file in the chat: preview, live updates and download. */
export async function fileCard(p: string): Promise<Card> {
  const root = await fs.realpath(WORKSPACE_DIR);
  const abs = await safePath(p);
  const st = await fs.stat(abs);
  if (!st.isFile()) throw new Error(`${p} is not a file.`);
  const mime = mimeOf(abs);
  return { type: 'file', path: rel(abs, root), name: path.basename(abs), size: st.size, mime, kind: INLINE_IMAGE.test(mime) ? 'image' : looksText(abs, mime) ? 'text' : 'other', updated: st.mtimeMs };
}

async function announce(p: string) {
  try {
    const card = await fileCard(p);
    emit({ type: 'workspace.file', path: card.path, size: card.size, updated: card.updated });
    return card;
  } catch {
    return null;
  }
}

/** path → mtime for workspace files (hidden folders skipped, capped), to see what a script changed. */
async function snapshot(): Promise<Map<string, number>> {
  const root = await fs.realpath(WORKSPACE_DIR);
  const out = new Map<string, number>();
  const walk = async (dir: string, depth: number) => {
    if (depth > 6 || out.size > 3000) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs, depth + 1);
      else if (e.isFile()) out.set(rel(abs, root), (await fs.stat(abs)).mtimeMs);
    }
  };
  await walk(root, 0);
  return out;
}

/**
 * Find a file the way a model tends to name it: "file:Report.txt", "/workspace/out/report.txt",
 * or just the file name when it lives in a subfolder (newest match wins).
 */
export async function resolveFile(raw: string, chat?: string): Promise<string> {
  let p = raw.trim().replace(/^(file|sandbox|attachment):\/*/i, '').replace(/^\/?(mnt\/data|workspace)\//i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* already plain */
  }
  // Inside a chat: its own folder first (and its outputs/), then the path as given.
  const home = chat ? chatDir(chat) : '';
  const candidates = chat ? [`${home}/${p}`, `${home}/outputs/${p}`, p] : [p];
  for (const c of candidates) {
    try {
      const st = await fs.stat(await safePath(c));
      if (st.isFile()) return c;
    } catch {
      /* try the next */
    }
  }
  // Then by name: newest match in this chat's folder or shared/ (anywhere, outside a chat).
  const want = path.basename(p).toLowerCase();
  let best: { path: string; mtime: number } | null = null;
  for (const [rp, mtime] of await snapshot()) {
    if (chat && !rp.startsWith(home + '/') && !rp.startsWith('shared/')) continue;
    if (path.basename(rp).toLowerCase() === want && (!best || mtime > best.mtime)) best = { path: rp, mtime };
  }
  if (!best) throw Object.assign(new Error('This file no longer exists.'), { code: 'ENOENT' });
  return best.path;
}

/** File routes for the chat's file cards (behind session auth). */
export function workspaceRoutes(r: express.Router) {
  r.get('/files/meta', async (req, res) => {
    try {
      const card = await fileCard(await resolveFile(String(req.query.path ?? ''), typeof req.query.chat === 'string' ? req.query.chat : undefined));
      let text: string | undefined;
      let truncated = false;
      if (card.kind === 'text') {
        const buf = await fs.readFile(await safePath(String(card.path)));
        truncated = buf.length > 300_000;
        text = buf.subarray(0, 300_000).toString('utf8');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...card, text, truncated });
    } catch (err) {
      res.status(404).json({ error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'This file no longer exists.' : (err as Error).message });
    }
  });
  r.get('/files/raw', async (req, res) => {
    try {
      const card = await fileCard(await resolveFile(String(req.query.path ?? ''), typeof req.query.chat === 'string' ? req.query.chat : undefined));
      const abs = await safePath(String(card.path));
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      // Only raster images are shown inline; everything else is a download, never rendered on this origin.
      if (card.kind === 'image' && req.query.download !== '1') {
        res.setHeader('Content-Type', String(card.mime));
        return res.sendFile(abs);
      }
      res.attachment(String(card.name));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.sendFile(abs);
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });
}

registerTool({
  name: 'show_file',
  label: 'Show file',
  group: 'Workspace',
  description:
    'Show the user files from this chat\'s folder as cards, right where you call it: a live preview (text, code or image) with a download button. Files in outputs/ are shown automatically; use this for anything else you want to hand over.',
  parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Paths in this chat\'s folder' } }, required: ['paths'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Show ${(a.paths ?? []).join(', ')}`,
  async run(a, ctx) {
    const cards: Card[] = [];
    const missing: string[] = [];
    for (const p of (Array.isArray(a.paths) ? a.paths : [a.paths]).slice(0, 8)) {
      try {
        cards.push(await fileCard(chatRel(ctx.conversationId, p)));
      } catch {
        missing.push(String(p));
      }
    }
    const shown = cards.map((c) => chatView(ctx.conversationId, String(c.path))).join(', ');
    return { content: `${shown ? `Shown to the user: ${shown}.` : 'Nothing shown.'}${missing.length ? ` Not found: ${missing.join(', ')}.` : ''}`, cards };
  },
});

registerTool({
  name: 'file_list',
  label: 'List files',
  group: 'Workspace',
  description: "List files in this chat's folder (or a subfolder, or shared/ for files kept across chats).",
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Subfolder (default: the chat folder)' } } },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `List ${a.path || 'files'}`,
  async run(a, ctx) {
    const dir = await chatPath(ctx.conversationId, a.path ?? '.');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lines = await Promise.all(
      entries
        .filter((e) => !e.name.startsWith('.'))
        .map(async (e) => {
          if (e.isDirectory()) return `${e.name}/`;
          const st = await fs.stat(path.join(dir, e.name));
          return `${e.name}  (${st.size} bytes)`;
        }),
    );
    return lines.length ? lines.join('\n') : '(empty)';
  },
});

registerTool({
  name: 'file_read',
  label: 'Read file',
  group: 'Workspace',
  description: "Read a text file from this chat's folder (or shared/).",
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Read ${a.path}`,
  async run(a, ctx) {
    const text = await fs.readFile(await chatPath(ctx.conversationId, a.path), 'utf8');
    return truncate(text, 40_000);
  },
});

registerTool({
  name: 'file_write',
  label: 'Write file',
  group: 'Workspace',
  description:
    "Create or overwrite a text file in this chat's folder (parent folders are created; append adds to the end). Save finished files the user should get under outputs/ (e.g. outputs/essay-plan.md): they appear in the chat automatically as a live card with a download button. Use other paths for scratch work.",
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
    required: ['path', 'content'],
  },
  risk: 'medium',
  defaultPolicy: 'auto',
  summarize: (a) => `${a.append ? 'Append to' : 'Write'} ${a.path}`,
  async run(a, ctx) {
    const wrel = chatRel(ctx.conversationId, a.path);
    const target = await chatPath(ctx.conversationId, a.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (a.append) await fs.appendFile(target, String(a.content));
    else await fs.writeFile(target, String(a.content));
    const card = await announce(wrel);
    const shown = isOutput(ctx.conversationId, wrel);
    const where = chatView(ctx.conversationId, wrel);
    return {
      content: `Wrote ${String(a.content).length} characters to ${where}. ${shown ? 'The user sees it as a file card with a download button.' : 'This is not shown to the user (it is not in outputs/); call show_file if they should get it.'}`,
      cards: shown && card ? [card] : [],
    };
  },
});

registerTool({
  name: 'run_script',
  label: 'Run script',
  group: 'Workspace',
  description:
    'Run a Python, Node.js or Bash script on the server, with the workspace as the working directory. Returns exit code, stdout and stderr. API keys and server secrets are not available to scripts.',
  parameters: {
    type: 'object',
    properties: {
      language: { type: 'string', enum: ['python', 'node', 'bash'] },
      code: { type: 'string' },
      timeout_sec: { type: 'integer' },
    },
    required: ['language', 'code'],
  },
  risk: 'high',
  defaultPolicy: 'ask',
  summarize: (a) => `Run ${a.language} script (${String(a.code).split('\n').length} lines)`,
  async run(a, ctx) {
    const cfg = getSettings().scripts;
    if (!cfg.enabled) return 'Script execution is turned off in Settings → Permissions.';
    const lang = a.language as 'python' | 'node' | 'bash';
    const ext = { python: 'py', node: 'mjs', bash: 'sh' }[lang];
    const bin = { python: cfg.python, node: cfg.node, bash: cfg.bash }[lang];
    if (!ext || !bin) return `Unsupported language: ${a.language}`;
    const dir = path.join(WORKSPACE_DIR, '.scripts');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id()}.${ext}`);
    await fs.writeFile(file, String(a.code));
    const timeout = Math.min(Number(a.timeout_sec) || cfg.timeoutSec, 600) * 1000;
    const cwd = await chatPath(ctx.conversationId, '.');
    const home = chatDir(ctx.conversationId) + '/';
    const before = await snapshot();
    try {
      const out = await new Promise<string>((resolve) => {
        // A minimal environment: no API keys or other server secrets leak into scripts.
        const child = spawn(bin, [file], {
          cwd,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: WORKSPACE_DIR, LANG: 'C.UTF-8', TZ: process.env.TZ ?? '', ...proxyEnv() },
          signal: ctx.signal,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
          stdout += d;
          ctx.progress?.(String(d));
        });
        child.stderr.on('data', (d) => (stderr += d));
        const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
        child.on('error', (err) => {
          clearTimeout(timer);
          resolve(`Failed to start ${bin}: ${err.message}`);
        });
        child.on('close', (code, sig) => {
          clearTimeout(timer);
          resolve(
            `exit code: ${code ?? sig}${sig === 'SIGKILL' ? ' (timed out)' : ''}\n\nstdout:\n${truncate(stdout, 15_000) || '(empty)'}\n\nstderr:\n${truncate(stderr, 6_000) || '(empty)'}`,
          );
        });
      });
      // Files the script created or changed: refresh any open file cards and tell the agent.
      const after = await snapshot();
      const changed = [...after].filter(([p, m]) => before.get(p) !== m && (p.startsWith(home) || p.startsWith('shared/'))).map(([p]) => p);
      const cards: Card[] = [];
      for (const p of changed.slice(0, 20)) {
        const card = await announce(p);
        if (card && isOutput(ctx.conversationId, p) && cards.length < 8) cards.push(card);
      }
      const names = changed.slice(0, 20).map((p) => chatView(ctx.conversationId, p));
      const note = changed.length
        ? `\n\nFiles created or changed: ${names.join(', ')}${changed.length > 20 ? ' …' : ''}${cards.length ? ` (files in outputs/ are now shown to the user)` : ' (save deliverables under outputs/ so the user gets them)'}`
        : '';
      return { content: out + note, cards };
    } finally {
      await fs.rm(file, { force: true });
    }
  },
});
