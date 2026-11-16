import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { UPLOAD_DIR } from './config.js';
import { get, run } from './db.js';
import type { ImagePart } from './llm/types.js';
import { id, now } from './util.js';

/** Image formats every supported model provider accepts. */
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString() === 'GIF8' },
};

export interface UploadRow {
  id: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: number;
}

const fileFor = (u: Pick<UploadRow, 'id' | 'mime'>) => path.join(UPLOAD_DIR, `${u.id}.${TYPES[u.mime]?.ext ?? 'bin'}`);

export function getUpload(uid: string) {
  return get<UploadRow>('SELECT * FROM uploads WHERE id = ?', uid);
}

export function readImage(uid: string): ImagePart | null {
  const u = getUpload(uid);
  if (!u) return null;
  try {
    return { mime: u.mime, data: fs.readFileSync(fileFor(u)).toString('base64') };
  } catch {
    return null;
  }
}

/** Routes mounted behind session auth. */
export function uploadRoutes(r: express.Router) {
  r.post('/uploads', express.raw({ type: 'image/*', limit: '15mb' }), (req: Request, res: Response) => {
    const mime = String(req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const body = req.body as Buffer;
    const type = TYPES[mime];
    if (!type) return res.status(415).json({ error: 'Use a JPEG, PNG, WebP or GIF image.' });
    if (!Buffer.isBuffer(body) || !body.length || !type.magic(body)) return res.status(400).json({ error: 'That file is not a valid image.' });
    const width = Number(req.get('x-image-width')) || null;
    const height = Number(req.get('x-image-height')) || null;
    const uid = id('img_');
    fs.writeFileSync(fileFor({ id: uid, mime }), body);
    run('INSERT INTO uploads (id, mime, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)', uid, mime, body.length, width, height, now());
    res.json({ id: uid, mime, size: body.length, width, height });
  });

  r.get('/uploads/:id', (req: Request, res: Response) => {
    const u = getUpload(String(req.params.id));
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', u.mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.sendFile(fileFor(u));
  });
}
