import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/** Where the database, workspace and generated keys live. */
export const DATA_DIR = path.resolve(process.env.SABLE_DATA_DIR ?? path.join(repoRoot, 'data'));
/** The only directory the agent's file and script tools can touch. */
export const WORKSPACE_DIR = path.join(DATA_DIR, 'workspace');
export const WEB_DIST = path.resolve(process.env.SABLE_WEB_DIST ?? path.join(repoRoot, 'web', 'dist'));
export const PORT = Number(process.env.PORT ?? 8787);
export const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * Sable always identifies itself as an automated agent when it touches the web.
 * (Agents that pretend to be a human browser get blocked — and deserve to.)
 */
export const AGENT_USER_AGENT = 'SableAgent/0.1 (+self-hosted personal AI agent; automated)';

/** Images people attach to messages. */
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
