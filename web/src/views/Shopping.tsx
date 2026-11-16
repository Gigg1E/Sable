import { CreditCard, ExternalLink, Link2, ShieldCheck, ShoppingBag, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import type { Settings } from '../lib/types';

type Edit = (fn: (d: Settings) => void) => void;
interface Status {
  linked: boolean;
  linkedAt: number | null;
  account: { name: string | null; email: string | null; addresses: number; cards: string[] } | null;
  error?: string;
}

export function ShoppingSection({ draft, edit }: { draft: Settings; edit: Edit }) {
  const toast = useStore((s) => s.toast);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const s = draft.shopping;
  const set = (fn: (x: Settings['shopping']) => void) => edit((d) => fn(d.shopping));

  const load = () => void api.get<Status>('/shop/status').then(setStatus).catch(() => setStatus({ linked: false, linkedAt: null, account: null }));
  useEffect(() => {
    load();
    const q = new URLSearchParams(location.search);
    if (q.get('shop_linked')) toast({ title: 'Shop account linked', tone: 'success' });
    if (q.get('shop_error')) toast({ title: 'Could not link Shop', body: q.get('shop_error')!, tone: 'error' });
    if (q.size) navigate('/settings/shopping', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function link() {
    setBusy(true);
    const r = await api.post<{ ok: boolean; url?: string; error?: string }>('/shop/link');
    setBusy(false);
    if (!r.ok) return toast({ title: 'Could not start linking', body: r.error, tone: 'error' });
    if (r.url) location.href = r.url;
    else load();
  }

  return (
    <>
      <section className="mb-10">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Shop</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
          Search millions of products from Shopify stores with live prices and stock, keep carts, and check out with Shop Pay. Search works without an account. Prices, photos and totals you see in chat come straight from the store.
        </p>
        <Card className="mt-4 divide-y divide-line">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <span className="flex size-9 items-center justify-center rounded-md border border-line bg-panel-2">
              <ShoppingBag className="size-4 text-fg-2" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">Shop account</div>
              <div className="text-[12px] text-fg-3">
                {!status ? (
                  <Spinner className="size-3" />
                ) : status.linked ? (
                  <>
                    Linked{status.account?.name ? ` as ${status.account.name}` : ''}
                    {status.account?.email ? ` · ${status.account.email}` : ''}
                    {status.error ? ` · ${status.error}` : ''}
                  </>
                ) : (
                  'Not linked. Needed for saved addresses, Shop Pay checkout and order tracking.'
                )}
              </div>
            </div>
            {status?.linked ? (
              <Button size="sm" variant="ghost" onClick={() => void api.post('/shop/unlink').then(load)}>
                <Unlink className="size-3.5" /> Unlink
              </Button>
            ) : (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void link()}>
                <Link2 className="size-3.5" /> Link Shop account
              </Button>
            )}
          </div>
          {status?.linked && status.account && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-[12.5px] text-fg-2">
              <span>{status.account.addresses} saved address{status.account.addresses === 1 ? '' : 'es'}</span>
              <span className="flex items-center gap-1.5">
                <CreditCard className="size-3.5 text-fg-3" />
                {status.account.cards.length ? status.account.cards.join(', ') : 'No saved cards. Add one in the Shop app.'}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div>
              <div className="text-[13px] font-medium">Shopping tools</div>
              <div className="text-xs text-fg-3">Let the agent search, compare, show products and manage carts.</div>
            </div>
            <Toggle checked={s.enabled} onChange={(v) => set((x) => void (x.enabled = v))} />
          </div>
        </Card>
        {!draft.publicUrl.startsWith('https://') && !status?.linked && (
          <p className="mt-2 text-xs text-accent">Linking needs Sable on a public HTTPS address (Shop fetches a small client file from it). Set Settings → Network → Public URL first.</p>
        )}
      </section>

      <section className="mb-10">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Purchases</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
          The agent can place orders with the card saved in your Shop account. Every order shows you the exact items, photos, address, shipping and total from the store and waits for you to tick a box and approve. This can never be set to
          automatic.
        </p>
        <Card className="mt-4 divide-y divide-line">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div>
              <div className="text-[13px] font-medium">Allow the agent to place orders</div>
              <div className="text-xs text-fg-3">Off: the agent prepares checkout and gives you the store's link to pay yourself.</div>
            </div>
            <Toggle checked={s.purchases} onChange={(v) => set((x) => void (x.purchases = v))} />
          </div>
          <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-3">
            <Field label="Per-order limit" hint="Orders above this are refused.">
              <Input type="number" min={1} value={s.maxOrder} onChange={(e) => set((x) => void (x.maxOrder = Number(e.target.value)))} />
            </Field>
            <Field label="Currency">
              <Input value={s.currency} maxLength={3} onChange={(e) => set((x) => void (x.currency = e.target.value.toUpperCase()))} />
            </Field>
            <Field label="Ship-to country" hint="Two letters, e.g. US, CA, GB.">
              <Input value={s.country} maxLength={2} onChange={(e) => set((x) => void (x.country = e.target.value.toUpperCase()))} />
            </Field>
          </div>
        </Card>
        {s.purchases && (
          <div className="mt-3 flex gap-2.5 rounded-md border border-accent/30 bg-accent-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              AI models make mistakes: they can pick the wrong size, misread a request, or be misled by a web page. Sable shows the store's real data and re-checks the checkout right before paying, so it stops if anything
              changed after you approved. But you are the final check: always read the confirmation.
            </span>
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Why can't I enter a card here?</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
          Shopify doesn't let agents submit raw card numbers to stores (its agent card handler is restricted), and a card number the AI can read could leak through a malicious page or prompt. Instead, your cards stay saved in your Shop
          account, protected by Shopify, and Sable only ever sees a masked label like “Visa •••• 4242”.{' '}
          <a className="inline-flex items-center gap-1 text-fg underline underline-offset-2" href="https://shop.app" target="_blank" rel="noreferrer">
            Manage cards in Shop <ExternalLink className="size-3" />
          </a>
        </p>
      </section>
    </>
  );
}
