import fs from 'node:fs';
import { addItem } from './library.js';

const TEXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|ini|html?|css|js|ts|tsx|jsx|py|sh|sql|xml|log|rs|go|java|c|cpp|h)$/i;

/** A file Sable wrote into a chat's outputs/: add or refresh it in the Library (best effort). */
export function libraryFile(conversationId: string, rel: string, absPath: string) {
  if (!TEXT.test(rel)) return;
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > 1_000_000) return;
    const text = fs.readFileSync(absPath, 'utf8');
    if (text.trim().length < 40) return;
    addItem({ kind: 'output', title: rel.split('/').pop() ?? rel, body: text, source: 'chat', sourceRef: rel, url: `sable://chat/${conversationId}/${rel}`, conversationId, trust: 'agent' });
  } catch {
    /* gone already */
  }
}
