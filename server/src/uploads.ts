import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { UPLOAD_DIR, WORKSPACE_DIR } from './config.js';
import { get, run } from './db.js';
import type { ImagePart } from './llm/types.js';
import { id, now, truncate, untrusted } from './util.js';

/**
 * Attachments. Images go to the model as pictures; any other file is saved into the workspace
 * (uploads/<name>) so the agent can read it, run scripts on it and hand back edited versions.
 */

/** Image formats every supported model provider accepts. */
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString() === 'GIF8' },
};

export const MAX_UPLOAD_MB = 25;

export interface UploadRow {
  id: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: number;
  /** Original file name. */
  name: string | null;
  /** Path inside the workspace (files, and copies of images). */
  path: string | null;
}

export interface AttachmentInfo {
  id: string;
  kind: 'image' | 'file';
  mime: string;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  path: string | null;
}

const imageFile = (u: Pick<UploadRow, 'id' | 'mime'>) => path.join(UPLOAD_DIR, `${u.id}.${TYPES[u.mime]?.ext ?? 'bin'}`);
const isImage = (u: Pick<UploadRow, 'mime'>) => !!TYPES[u.mime];

export function getUpload(uid: string) {
  return get<UploadRow>('SELECT * FROM uploads WHERE id = ?', uid);
}

export function attachmentInfo(uid: string): AttachmentInfo {
  const u = getUpload(uid);
  if (!u) return { id: uid, kind: 'file', mime: 'application/octet-stream', name: 'missing file', size: 0, width: null, height: null, path: null };
  return {
    id: uid,
    kind: isImage(u) ? 'image' : 'file',
    mime: u.mime,
    name: u.name ?? (isImage(u) ? `image.${TYPES[u.mime].ext}` : 'file'),
    size: u.size,
    width: u.width,
    height: u.height,
    path: u.path,
  };
}

export function readImage(uid: string): ImagePart | null {
  const u = getUpload(uid);
  if (!u || !isImage(u)) return null;
  try {
    return { mime: u.mime, data: fs.readFileSync(imageFile(u)).toString('base64') };
  } catch {
    return null;
  }
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|log|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|swift|r|lua|pl|env|srt|vtt|ics|tex|rst|org)$/i;
export function looksText(name: string, mime: string) {
  return mime.startsWith('text/') || /json|xml|yaml|csv|javascript|typescript|x-sh|sql|toml/.test(mime) || TEXT_EXT.test(name);
}

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * What the model sees for an attached (non-image) file: where it is, and for text files the
 * contents themselves (when `inline`), marked as untrusted data.
 */
export function attachmentForModel(uid: string, inline: boolean): string | null {
  const a = attachmentInfo(uid);
  if (a.kind === 'image') return null;
  const where = a.path ? `workspace path "${a.path}"` : 'no longer available';
  let out = `[Attached file: ${a.name} (${fmtSize(a.size)}, ${a.mime}), ${where}]`;
  if (inline && a.path && looksText(a.name, a.mime) && a.size <= 400_000) {
    try {
      const text = fs.readFileSync(path.join(WORKSPACE_DIR, a.path), 'utf8');
      out += '\n' + untrusted(`file ${a.name}`, truncate(text, 30_000));
    } catch {
      /* moved or deleted since */
    }
  } else if (a.path) {
    out += ' (read it with file_read, or process it with run_script)';
  }
  return out;
}

/** A safe file name: no folders, control characters or leading dots. */
function cleanName(raw: string) {
  let n = raw.replace(/[\\/]/g, '_').replace(/[\x00-\x1f\x7f<>:"|?*]/g, '').trim().replace(/^\.+/, '');
  if (n.length > 120) {
    const ext = path.extname(n).slice(0, 12);
    n = n.slice(0, 120 - ext.length) + ext;
  }
  return n || 'file';
}

/** Save into workspace/uploads without overwriting: "report.csv", "report (2).csv"… */
function saveToWorkspace(name: string, body: Buffer): string {
  const dir = path.join(WORKSPACE_DIR, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  fs.writeFileSync(path.join(dir, candidate), body);
  return `uploads/${candidate}`;
}

/** Routes mounted behind session auth. */
export function uploadRoutes(r: express.Router) {
  r.post('/uploads', express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), (req: Request, res: Response) => {
    const mime = String(req.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'That file is empty.' });
    let name = 'file';
    try {
      name = cleanName(decodeURIComponent(String(req.get('x-file-name') ?? '')));
    } catch {
      /* keep default */
    }
    const image = TYPES[mime];
    if (mime.startsWith('image/') && image && !image.magic(body)) return res.status(400).json({ error: 'That file is not a valid image.' });

    if (image) {
      const width = Number(req.get('x-image-width')) || null;
      const height = Number(req.get('x-image-height')) || null;
      const uid = id('img_');
      fs.writeFileSync(imageFile({ id: uid, mime }), body);
      const fname = name === 'file' || !path.extname(name) ? `image-${uid.slice(4, 10)}.${image.ext}` : name;
      const wpath = saveToWorkspace(fname, body);
      run('INSERT INTO uploads (id, mime, size, width, height, created_at, name, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', uid, mime, body.length, width, height, now(), fname, wpath);
      return res.json(attachmentInfo(uid));
    }

    const uid = id('file_');
    const wpath = saveToWorkspace(name, body);
    run('INSERT INTO uploads (id, mime, size, width, height, created_at, name, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', uid, mime, body.length, null, null, now(), name, wpath);
    res.json(attachmentInfo(uid));
  });

  r.get('/uploads/:id', (req: Request, res: Response) => {
    const u = getUpload(String(req.params.id));
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isImage(u)) {
      res.setHeader('Content-Type', u.mime);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      return res.sendFile(imageFile(u));
    }
    // Other files are only ever downloaded, never rendered on this origin.
    const file = u.path ? path.join(WORKSPACE_DIR, u.path) : '';
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'This file was moved or deleted from the workspace.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(u.name ?? 'file');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(file);
  });
}
