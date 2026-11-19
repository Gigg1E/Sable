import { motion } from 'motion/react';
import { Check, KeyRound, Lock, Plug, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { onServerEvent } from '../lib/store';
import type { ConnectionInfo, CredentialCardData } from '../lib/types';
import { Badge, Button, Card, Input } from './ui';

export const AUTH_LABEL: Record<string, string> = {
  bearer: 'Bearer token',
  header: 'API key header',
  query: 'API key in URL',
  basic: 'Username and password',
  'aws-sigv4': 'AWS signed requests',
  none: 'No credential (public)',
};
export const FORMAT_HINT: Record<string, string> = {
  bearer: 'the token',
  header: 'the API key',
  query: 'the API key',
  basic: 'username:password',
  'aws-sigv4': 'ACCESS_KEY_ID:SECRET_ACCESS_KEY',
  none: '',
};

/** A password field that sends the credential straight to the server's vault; the model never sees it. */
export function CredentialField({ name, style, onSaved, hasSecret }: { name: string; style: string; hasSecret?: boolean; onSaved?: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(!!hasSecret);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.put(`/connections/${name}/secret`, { value });
      setValue('');
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) void save();
      }}
    >
      <div className="min-w-[200px] flex-1">
        <Input type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={saved ? 'Saved. Enter a new one to replace it' : `Paste ${FORMAT_HINT[style] || 'the credential'}`} />
      </div>
      <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!value.trim()}>
        <Lock className="size-3.5" /> {saved ? 'Replace' : 'Save securely'}
      </Button>
      {saved && !value && (
        <span className="inline-flex items-center gap-1 text-[12px] text-ok">
          <Check className="size-3.5" /> Stored encrypted
        </span>
      )}
      {error && <span className="basis-full text-[12px] text-danger">{error}</span>}
    </form>
  );
}

/** Shown in chat right after a connection is created. */
export function CredentialCard({ card }: { card: CredentialCardData }) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const load = () => void api.get<ConnectionInfo[]>('/connections').then((l) => setHas(!!l.find((c) => c.name === card.name)?.hasSecret));
    load();
    return onServerEvent((ev) => ev.type === 'connections.changed' && load());
  }, [card.name]);
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="my-2.5 rounded-xl border border-tint/30 bg-panel p-3.5">
      <div className="mb-1 flex items-center gap-2 text-[13.5px] font-medium">
        <KeyRound className="size-4 text-tint" /> Credential for “{card.name}” <span className="font-mono text-[11.5px] font-normal text-fg-3">{card.host}</span>
      </div>
      {card.help && <p className="mb-2.5 text-[12.5px] leading-relaxed text-fg-2">{card.help}</p>}
      <CredentialField name={card.name} style={card.style} hasSecret={has} />
      <p className="mt-2 text-[11.5px] text-fg-3">Goes straight to your server's encrypted vault. The AI never sees it, and it's only ever sent to {card.host}. Don't paste keys into the chat.</p>
    </motion.div>
  );
}

/** Settings → Connectors → Connections. */
export function ConnectionsSection() {
  const [list, setList] = useState<ConnectionInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const load = () => void api.get<ConnectionInfo[]>('/connections').then(setList);
    load();
    return onServerEvent((ev) => ev.type === 'connections.changed' && load());
  }, []);
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Connections</h2>
        <Badge tone="outline">built by the agent</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
        Ask for something from an account with an API ("how much did AWS cost me this month?") and the agent researches the API, proposes a connection for you to approve, and tells you what key to create. Keys are stored encrypted and only sent to that connection's own server. Reading runs on its own; anything that changes something asks you first.
      </p>
      <Card className="mt-4 divide-y divide-line">
        {list && !list.length && <p className="px-4 py-5 text-center text-[13px] text-fg-3">No connections yet.</p>}
        {(list ?? []).map((c) => (
          <div key={c.name} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Plug className="size-4 text-fg-3" />
              <span className="font-mono text-[13.5px] font-medium">{c.name}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">{c.purpose}</span>
              <span className={cx('text-[12px]', c.hasSecret || c.auth.style === 'none' ? 'text-ok' : 'text-accent')}>{c.hasSecret || c.auth.style === 'none' ? 'Ready' : 'Needs credential'}</span>
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.name ? null : c.name)}>
                {open === c.name ? 'Close' : c.auth.style === 'none' ? 'Details' : c.hasSecret ? 'Key' : 'Add key'}
              </Button>
              <button
                aria-label="Remove"
                onClick={() => confirm(`Remove "${c.name}" and its stored key?`) && void api.del(`/connections/${c.name}`)}
                className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-panel-2 hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="mt-1 pl-7 font-mono text-[11.5px] text-fg-3">
              {c.baseUrl} · {AUTH_LABEL[c.auth.style]} · reads {c.readMethods.join('/')} freely{c.lastUsed ? ` · used ${timeAgo(c.lastUsed)}` : ''}
            </div>
            {open === c.name && (
              <div className="mt-3 space-y-2 pl-7">
                {c.credentialHelp && <p className="text-[12.5px] leading-relaxed text-fg-2">{c.credentialHelp}</p>}
                {c.auth.style !== 'none' && <CredentialField name={c.name} style={c.auth.style} hasSecret={c.hasSecret} />}
              </div>
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}
