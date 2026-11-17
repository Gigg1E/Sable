import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type express from 'express';
import { WORKSPACE_DIR } from '../../config.js';
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

/** File routes for the chat's file cards (behind session auth). */
export function workspaceRoutes(r: express.Router) {
  r.get('/files/meta', async (req, res) => {
    try {
      const card = await fileCard(String(req.query.path ?? ''));
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
      const card = await fileCard(String(req.query.path ?? ''));
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
    'Show the user one or more workspace files as cards in the chat, right where you call it: a live preview (text, code or image) with a download button. Use it to hand over anything you made or changed, e.g. a file a script produced. (file_write already shows the file it writes.)',
  parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Workspace paths' } }, required: ['paths'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Show ${(a.paths ?? []).join(', ')}`,
  async run(a) {
    const cards: Card[] = [];
    const missing: string[] = [];
    for (const p of (Array.isArray(a.paths) ? a.paths : [a.paths]).slice(0, 8)) {
      try {
        cards.push(await fileCard(String(p)));
      } catch {
        missing.push(String(p));
      }
    }
    const shown = cards.map((c) => c.path).join(', ');
    return { content: `${shown ? `Shown to the user: ${shown}.` : 'Nothing shown.'}${missing.length ? ` Not found: ${missing.join(', ')}.` : ''}`, cards };
  },
});

registerTool({
  name: 'file_list',
  label: 'List files',
  group: 'Workspace',
  description: "List files in the agent's workspace folder (a sandboxed directory on the server).",
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder inside the workspace (default root)' } } },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `List ${a.path || '/'}`,
  async run(a) {
    const dir = await safePath(a.path ?? '.');
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
  description: 'Read a text file from the workspace.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Read ${a.path}`,
  async run(a) {
    const text = await fs.readFile(await safePath(a.path), 'utf8');
    return truncate(text, 40_000);
  },
});

registerTool({
  name: 'file_write',
  label: 'Write file',
  group: 'Workspace',
  description: 'Create or overwrite a text file in the workspace (parent folders are created). Set append to add to the end instead. The user sees the file live in the chat, with a download button, so write it here instead of pasting long documents into your reply.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
    required: ['path', 'content'],
  },
  risk: 'medium',
  defaultPolicy: 'auto',
  summarize: (a) => `${a.append ? 'Append to' : 'Write'} ${a.path}`,
  async run(a) {
    const target = await safePath(a.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (a.append) await fs.appendFile(target, String(a.content));
    else await fs.writeFile(target, String(a.content));
    const card = await announce(a.path);
    return { content: `Wrote ${String(a.content).length} characters to ${a.path}. The user sees it as a file card with a download button.`, cards: card ? [card] : [] };
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
    const before = await snapshot();
    try {
      const out = await new Promise<string>((resolve) => {
        // A minimal environment: no API keys or other server secrets leak into scripts.
        const child = spawn(bin, [file], {
          cwd: WORKSPACE_DIR,
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
      const changed = [...after].filter(([p, m]) => before.get(p) !== m).map(([p]) => p);
      for (const p of changed.slice(0, 20)) void announce(p);
      return changed.length ? `${out}\n\nFiles created or changed: ${changed.slice(0, 20).join(', ')}${changed.length > 20 ? ' …' : ''} (use show_file to hand them to the user)` : out;
    } finally {
      await fs.rm(file, { force: true });
    }
  },
});
