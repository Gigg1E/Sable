import { emit } from '../../events.js';
import { outputByName, pushTo } from '../../push.js';
import { getSettings, updateSettings, type Channel } from '../../settings.js';
import { errorMessage } from '../../util.js';
import { registerTool } from './registry.js';

/**
 * Webhook outputs: places Sable pushes to (Discord, Slack, ntfy, any URL). The user's saved
 * outputs can be used by name without asking; saving a new one asks the user first.
 */

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
const kindOf = (url: string): Channel['type'] =>
  /discord(app)?\.com\/api\/webhooks/.test(url) ? 'discord' : /hooks\.slack\.com/.test(url) ? 'slack' : /ntfy/.test(hostOf(url)) ? 'ntfy' : 'webhook';

registerTool({
  name: 'webhook_outputs',
  label: 'List webhooks',
  group: 'Webhooks',
  description: 'List the webhook outputs the user saved (Discord, Slack, ntfy, URLs) that you can push to by name with webhook_send.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  async run() {
    const list = getSettings().channels;
    if (!list.length) return 'No webhook outputs saved yet. Ask the user for a webhook link (e.g. Discord: channel settings → Integrations → Webhooks → Copy URL) and save it with webhook_save.';
    return list.map((c) => `- "${c.name}" (${c.type}, ${hostOf(c.url)})${c.enabled ? '' : ' [off]'}${c.events === 'none' ? '' : ' · also receives notifications'}`).join('\n');
  },
});

registerTool({
  name: 'webhook_send',
  label: 'Send to webhook',
  group: 'Webhooks',
  description:
    'Push a message to a saved webhook output by its name (see webhook_outputs), e.g. post a price drop to the user\'s Discord. Discord and Slack get a formatted message; other URLs get JSON with title, body and data. If the user gave you a new link, save it with webhook_save first.',
  parameters: {
    type: 'object',
    properties: { to: { type: 'string', description: 'Saved output name' }, title: { type: 'string' }, message: { type: 'string' }, data: { type: 'object', description: 'Extra JSON fields for generic webhooks' } },
    required: ['to', 'title'],
  },
  risk: 'medium',
  defaultPolicy: 'auto',
  summarize: (a) => `Send “${a.title}” to ${a.to}`,
  async run(a) {
    const ch = outputByName(String(a.to));
    if (!ch) return `There's no saved webhook called "${a.to}". Use webhook_outputs to see the saved ones, or ask the user for the link and save it with webhook_save.`;
    if (!ch.enabled) return `The webhook "${ch.name}" is turned off.`;
    try {
      await pushTo(ch.name, String(a.title), String(a.message ?? ''), a.data as Record<string, unknown> | undefined);
      return `Sent to "${ch.name}".`;
    } catch (err) {
      return `Sending to "${ch.name}" failed: ${errorMessage(err)}`;
    }
  },
});

registerTool({
  name: 'webhook_save',
  label: 'Save webhook',
  group: 'Webhooks',
  description:
    'Save a webhook link the user gave you as a named output (Discord, Slack, ntfy or any URL), so you and automations can send to it by name. Only use links the user provided. By default it only receives what you send it, not every notification.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Short name, e.g. "Deals Discord"' }, url: { type: 'string' }, also_notifications: { type: 'boolean', description: 'Also forward the user\'s notifications to it (default false)' } },
    required: ['name', 'url'],
  },
  risk: 'medium',
  defaultPolicy: 'ask',
  summarize: (a) => `Save webhook “${a.name}” (${hostOf(String(a.url))})`,
  async run(a) {
    const url = String(a.url).trim();
    if (!/^https:\/\//i.test(url)) return 'Webhook links must start with https://.';
    const s = getSettings();
    const name = String(a.name).trim() || hostOf(url);
    const existing = s.channels.find((c) => c.url === url || c.name.toLowerCase() === name.toLowerCase());
    if (existing) return `Already saved as "${existing.name}".`;
    let idBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'webhook';
    while (s.channels.some((c) => c.id === idBase)) idBase += '-2';
    updateSettings({ ...s, channels: [...s.channels, { id: idBase, name, type: kindOf(url), url, enabled: true, events: a.also_notifications ? 'important' : 'none' }] });
    emit({ type: 'settings.changed' });
    return `Saved "${name}" (${kindOf(url)}). Send to it with webhook_send to: "${name}".`;
  },
});
