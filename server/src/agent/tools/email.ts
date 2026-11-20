import { describeMailbox, emailAccount, emailAccounts, readMail, searchMail, sendMail } from '../../email.js';
import { getSettings } from '../../settings.js';
import { redact } from '../../safety.js';
import { resolveRecipient } from '../../people.js';
import { untrusted } from '../../util.js';
import { registerTool, unregisterWhere } from './registry.js';

/** Email tools, registered only when an account is connected. */
export function syncEmailTools() {
  unregisterWhere((t) => t.group === 'Email');
  const accounts = emailAccounts();
  if (!accounts.length) return;
  const which = {
    type: 'string',
    description: `Which mailbox (address or name). Default: ${(accounts.find((a) => a.isDefault) ?? accounts[0]).address}. Connected: ${accounts.map(describeMailbox).join(', ')}`,
  };

  registerTool({
    name: 'email_search',
    label: 'Search email',
    group: 'Email',
    description: "Search the user's inbox (newest first). Filter by sender, subject, text, recent days or unread. Returns ids to read with email_read.",
    parameters: {
      type: 'object',
      properties: { account: which, from: { type: 'string' }, subject: { type: 'string' }, text: { type: 'string' }, days: { type: 'integer', description: 'How far back (default 14)' }, unread: { type: 'boolean' }, limit: { type: 'integer' } },
    },
    risk: 'low',
    defaultPolicy: 'auto',
    summarize: (a) => `Search email${a.from ? ` from ${a.from}` : ''}${a.subject ? ` about “${a.subject}”` : ''}`,
    async run(a) {
      const acc = emailAccount(a.account);
      const list = await searchMail(acc, { from: a.from, subject: a.subject, text: a.text, sinceDays: a.days, unread: a.unread, limit: Math.min(Number(a.limit) || 15, 50) });
      if (!list.length) return `No matching email in ${acc.address}.`;
      return untrusted(`email ${acc.address}`, list.map((m) => `#${m.uid} ${m.unread ? '● ' : ''}${m.date.slice(0, 21)} · ${m.from} · ${m.subject}`).join('\n'));
    },
  });

  registerTool({
    name: 'email_read',
    label: 'Read email',
    group: 'Email',
    description: 'Read one email by its id from email_search.',
    parameters: { type: 'object', properties: { account: which, id: { type: 'integer' } }, required: ['id'] },
    risk: 'low',
    defaultPolicy: 'auto',
    summarize: (a) => `Read email #${a.id}`,
    async run(a) {
      const acc = emailAccount(a.account);
      const m = await readMail(acc, Number(a.id));
      return untrusted(`email from ${m.fromAddress}`, `From: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.text}`);
    },
  });

  registerTool({
    name: 'email_send',
    label: 'Send email',
    group: 'Email',
    description: "Send an email from the user's mailbox. Write it as the user would (plain text). Double-check the recipient address.",
    parameters: {
      type: 'object',
      properties: { account: which, to: { type: 'string', description: 'Email address(es), or the name of someone you know ("Jordan", "my sister"); names are filled in with their saved email' }, cc: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'subject', 'body'],
    },
    risk: 'high',
    defaultPolicy: 'ask',
    summarize: (a) => `Email ${a.to}: “${a.subject}”`,
    async run(a) {
      const acc = emailAccount(a.account);
      if (!/@/.test(String(a.to))) return 'That recipient is not an email address. Ask the user for it.';
      // Names ("Jordan", "my sister") become the saved address here, so the model never needs it.
      const resolve = (list: string) => list.split(',').map((x) => x.trim()).filter(Boolean).map((x) => resolveRecipient(x, 'email')).join(', ');
      const id = await sendMail(acc, { to: resolve(String(a.to)), cc: a.cc ? resolve(String(a.cc)) : undefined, subject: redact(String(a.subject)), text: redact(String(a.body)) });
      return `Sent from ${acc.address} to ${a.to} (message id ${id}).`;
    },
  });
}
