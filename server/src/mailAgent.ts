import { all, get, run } from './db.js';
import { createConversation, onRunDone, startRun, wakeChat } from './agent/runner.js';
import { journalAdd } from './brain.js';
import { mailEnabled, onMailCommand, profileLine, quoted, replyTo, type MailRow } from './mail.js';
import { errorMessage } from './util.js';

/**
 * The agent mailbox in practice: a verified email from you becomes a chat (one per email thread);
 * when Sable finishes, its answer is emailed back in the same thread. Anything sensitive it wants
 * to do along the way asks for approval in the app, like any other chat.
 */

export function startMailAgent() {
  onMailCommand((msg, mine, quotedText) => {
    // The same email thread continues the same chat.
    let cid = get<{ conversation_id: string }>("SELECT conversation_id FROM mail_messages WHERE thread_id = ? AND conversation_id IS NOT NULL ORDER BY uid DESC LIMIT 1", msg.thread_id)?.conversation_id;
    if (!cid || !get('SELECT id FROM conversations WHERE id = ?', cid)) cid = createConversation(`✉ ${(msg.subject ?? 'Email').replace(/^(re|fwd?):\s*/i, '').slice(0, 60)}`, 'mail');
    run('UPDATE mail_messages SET conversation_id = ? WHERE uid = ?', cid, msg.uid);
    const atts = JSON.parse(msg.attachments ?? '[]') as { name: string }[];
    const text = [
      `[Email from you: ${msg.subject ?? '(no subject)'} · ${msg.from_addr}]`,
      mine || '(empty message)',
      atts.length ? `\n(Attachments: ${atts.map((a) => a.name).join(', ')}; not opened.)` : '',
      quotedText ? `\n${quoted(quotedText.slice(0, 8000))}` : '',
      `\n(You sent this from ${msg.from_addr}, verified. Your final reply will be emailed back to them in this thread, so write it as an email: plain text, no tables. Anything that needs approval is approved in the Sable app.)`,
    ].join('\n');
    if (!wakeChat(cid, text)) startRun(cid, text, 'wake');
    journalAdd('event', `Emailed Sable from ${msg.from_addr}: "${msg.subject ?? ''}"`);
  });

  // When a mail chat finishes, reply by email to the latest message from you in that thread.
  onRunDone((conversationId, answer) => {
    if (!mailEnabled() || !answer.trim()) return;
    const conv = get<{ kind: string }>('SELECT kind FROM conversations WHERE id = ?', conversationId);
    if (conv?.kind !== 'mail') return;
    const last = all<MailRow>("SELECT * FROM mail_messages WHERE conversation_id = ? AND folder = 'inbox' ORDER BY uid DESC LIMIT 1", conversationId)[0];
    if (!last || last.answered) return;
    const body = answer.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    void replyTo(last, body).catch((err) => console.error('[mail reply]', errorMessage(err)));
  });
}

export { profileLine };
