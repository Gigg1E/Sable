import { addItem, forgetItem, forModel, getItem, libSnippet, search, type LibKind } from '../../library.js';
import { timeAgoText } from '../../util.js';
import { registerTool } from './registry.js';

/** The Library: shared across every chat and sub-agent. Reading never needs approval. */

const KINDS: LibKind[] = ['note', 'page', 'file', 'output', 'upload', 'person', 'action'];

registerTool({
  name: 'library_search',
  label: 'Search the Library',
  group: 'Library',
  description:
    "Search Sable's shared Library: notes, web pages read before, files made in any chat (outputs/), the user's uploads, and more. Use it whenever the answer may already exist: \"how did I do X\", \"that article about Y\", \"the plan we made\", before researching again. Returns snippets with ids; open one with library_get.",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      kinds: { type: 'array', items: { type: 'string', enum: KINDS }, description: 'Only these kinds (optional)' },
      limit: { type: 'integer', description: 'Max results (default 8)' },
    },
    required: ['query'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Search the Library for “${String(a.query).slice(0, 50)}”`,
  async run(a) {
    const hits = await search(String(a.query), { kinds: Array.isArray(a.kinds) ? a.kinds : undefined, limit: Number(a.limit) || 8 });
    if (!hits.length) return 'Nothing in the Library matches. (It holds pages Sable read, files made in chats, uploads and notes.)';
    return hits
      .map((h) => {
        const it = h.item;
        const from = it.url && !it.url.startsWith('sable://') ? it.url : it.conversation_id ? `chat ${it.conversation_id}` : it.source;
        return `[${it.id}] ${it.title} (${it.kind}, ${it.privacy}, ${timeAgoText(it.updated_at)}, from ${from})\n${forModel(it, libSnippet(h.chunk, 500))}`;
      })
      .join('\n\n');
  },
});

registerTool({
  name: 'library_get',
  label: 'Open a Library item',
  group: 'Library',
  description: 'Read a Library item in full by id (from library_search).',
  parameters: { type: 'object', properties: { id: { type: 'string' }, offset: { type: 'integer', description: 'Character offset for long items' } }, required: ['id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: () => 'Open a Library item',
  async run(a) {
    const it = getItem(String(a.id));
    if (!it) return 'No Library item with that id (it may have been forgotten).';
    const off = Math.max(0, Number(a.offset) || 0);
    const part = it.body.slice(off, off + 20_000);
    const more = it.body.length > off + 20_000 ? `\n\n(${it.body.length - off - 20_000} more characters; continue with offset ${off + 20_000})` : '';
    return `${it.title} (${it.kind}, ${it.privacy}${it.url && !it.url.startsWith('sable://') ? `, ${it.url}` : ''})\n\n${forModel(it, part)}${more}`;
  },
});

registerTool({
  name: 'library_add',
  label: 'Save to the Library',
  group: 'Library',
  description:
    'Save something to the shared Library so any chat can find it later: a note, a summary, a procedure that worked, a decision. Privacy is decided automatically (anything with personal details or secrets is private); pass private: true to force it. Files in outputs/, pages read with web_fetch and uploads are added on their own.',
  parameters: {
    type: 'object',
    properties: { title: { type: 'string' }, content: { type: 'string' }, private: { type: 'boolean' } },
    required: ['title', 'content'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Save “${String(a.title).slice(0, 50)}” to the Library`,
  async run(a, ctx) {
    const it = addItem({ kind: 'note', title: String(a.title), body: String(a.content), source: 'chat', conversationId: ctx.conversationId, trust: 'agent', privacy: a.private ? 'private' : undefined });
    return `Saved to the Library as ${it.id} (${it.privacy}${it.privacy_reason ? `: ${it.privacy_reason}` : ''}).`;
  },
});

registerTool({
  name: 'library_forget',
  label: 'Forget a Library item',
  group: 'Library',
  description: 'Permanently remove an item from the Library (and its search index). Only when the user asks.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Forget Library item ${a.id}`,
  async run(a) {
    return forgetItem(String(a.id)) ? 'Forgotten.' : 'No Library item with that id.';
  },
});
