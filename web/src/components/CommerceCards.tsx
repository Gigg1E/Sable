import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, MapPin, PackageCheck, ShieldCheck, ShoppingBag, ShoppingCart, Star, Truck } from 'lucide-react';
import { cx } from '../lib/format';
import type { CartLikeCard, CommerceCard, Money, OfferCard } from '../lib/types';
import { Badge, Tip } from './ui';

/**
 * Cards built by the server from the store's own data. Everything here (photos, options, prices,
 * stock, totals, addresses, order numbers) comes from Shop's responses, not from the model's text.
 */

function digits(currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}
export function money(m: Money | null | undefined) {
  if (!m || typeof m.amount !== 'number') return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(m.amount / 10 ** digits(m.currency));
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}

function Verified({ at, source = 'Shop' }: { at: number; source?: string }) {
  return (
    <Tip label="Pulled directly from the store when this was shown. The AI can't change these details, but it can still misread what you wanted.">
      <span className="inline-flex cursor-help items-center gap-1 text-[11px] text-fg-3">
        <ShieldCheck className="size-3 text-ok" /> Live from {source} · {new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </span>
    </Tip>
  );
}

function Thumb({ src, size = 44 }: { src: string | null; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain" /> : <ShoppingBag className="size-4 text-fg-3" />}
    </span>
  );
}

function ProductTile({ o }: { o: OfferCard }) {
  return (
    <motion.a
      href={o.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex w-[220px] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-1 transition-[border,box-shadow] hover:border-line-strong hover:shadow-2 sm:w-auto"
    >
      <div className="relative aspect-square bg-white">
        {o.image ? <img src={o.image} alt={o.title} loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain p-2 transition-transform group-hover:scale-[1.02]" /> : <ShoppingBag className="absolute inset-0 m-auto size-6 text-fg-3" />}
        {o.available === false && <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10.5px] font-medium text-white">Out of stock</span>}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="line-clamp-2 text-[13px] font-medium leading-snug">{o.title}</div>
        {o.options && <div className="mt-0.5 line-clamp-1 text-[12px] text-fg-3">{o.options}</div>}
        <div className="mt-auto pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[15px] font-semibold tabular">{money(o.price)}</span>
            {o.available && <span className="text-[11px] text-ok">In stock</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-fg-3">
            <span className="truncate">{o.seller.name}</span>
            {o.rating && (
              <span className="flex shrink-0 items-center gap-0.5">
                · <Star className="size-3 fill-current" /> {o.rating.value.toFixed(1)} ({o.rating.count})
              </span>
            )}
            <ExternalLink className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      </div>
    </motion.a>
  );
}

function ProductsCard({ card }: { card: Extract<CommerceCard, { type: 'products' }> }) {
  return (
    <div className="my-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-fg-2">{card.heading ?? (card.items.length === 1 ? 'Product' : `${card.items.length} products`)}</span>
        <Verified at={card.items[0]?.fetchedAt ?? Date.now()} source={card.source} />
      </div>
      <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
        {card.items.map((o) => (
          <ProductTile key={o.variantId} o={o} />
        ))}
      </div>
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'accent' | 'danger' | 'default' | 'info' }> = {
  ready_for_complete: { label: 'Ready to buy', tone: 'ok' },
  incomplete: { label: 'Needs details', tone: 'accent' },
  requires_escalation: { label: 'Needs your action', tone: 'accent' },
  complete_in_progress: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  canceled: { label: 'Canceled', tone: 'danger' },
};

export function CartCard({ card, compact }: { card: CartLikeCard; compact?: boolean }) {
  const isOrder = card.type === 'order';
  const isCheckout = card.type === 'checkout' || isOrder;
  const status = card.status ? STATUS[card.status] : null;
  const errors = card.messages.filter((m) => m.type === 'error');
  const notes = card.messages.filter((m) => m.type !== 'error');
  const Icon = isOrder ? PackageCheck : isCheckout ? CreditCard : ShoppingCart;
  const cta = card.continueUrl && !isOrder ? (isCheckout ? 'Finish checkout on store' : 'Open cart on store') : null;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx('overflow-hidden rounded-lg border bg-panel shadow-1', isOrder ? 'border-ok/40' : 'border-line', !compact && 'my-3')}>
      <div className={cx('flex items-center gap-2 border-b px-3.5 py-2.5', isOrder ? 'border-ok/25 bg-ok/8' : 'border-line bg-panel-2/50')}>
        <Icon className={cx('size-4', isOrder ? 'text-ok' : 'text-fg-2')} />
        <span className="text-[13px] font-medium">{isOrder ? 'Order placed' : isCheckout ? 'Checkout' : 'Cart'}</span>
        <span className="truncate text-[13px] text-fg-3">· {card.seller}</span>
        <span className="flex-1" />
        {status && !isOrder && <Badge tone={status.tone}>{status.label}</Badge>}
        {isOrder && card.order?.number && <span className="font-mono text-[12px] text-fg-2">{card.order.number}</span>}
      </div>

      <div className="divide-y divide-line">
        {card.lines.map((l) => (
          <div key={l.variantId + l.title} className="flex items-center gap-3 px-3.5 py-2.5">
            <Thumb src={l.image} />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[13px] leading-snug">{l.title}</div>
              <div className="font-mono text-[11.5px] text-fg-3 tabular">
                {l.quantity} × {money(l.unitPrice)}
              </div>
            </div>
            <span className="font-mono text-[13px] tabular">{money(l.total)}</span>
          </div>
        ))}
      </div>

      <div className="space-y-1 border-t border-line px-3.5 py-2.5">
        {card.totals.map((t) => (
          <div key={t.type + t.label} className={cx('flex justify-between text-[12.5px]', t.type === 'total' ? 'pt-1 text-[14px] font-semibold' : 'text-fg-2')}>
            <span>{t.label}</span>
            <span className="font-mono tabular">{money({ amount: t.amount, currency: card.currency })}</span>
          </div>
        ))}
        {isCheckout && !card.totals.some((t) => t.type === 'fulfillment' || t.type === 'shipping') && !isOrder && <div className="text-[11.5px] text-fg-3">Shipping and tax aren't calculated yet.</div>}
      </div>

      {isCheckout && (card.address || card.shipping || card.payWith || card.instruments.length > 0) && (
        <div className="space-y-1.5 border-t border-line px-3.5 py-2.5 text-[12.5px] text-fg-2">
          {card.address && (
            <div className="flex gap-2">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-fg-3" /> {card.address}
            </div>
          )}
          {card.shipping && (
            <div className="flex gap-2">
              <Truck className="mt-0.5 size-3.5 shrink-0 text-fg-3" /> {card.shipping.title}
              {card.shipping.amount != null && <span className="font-mono">· {money({ amount: card.shipping.amount, currency: card.currency })}</span>}
            </div>
          )}
          {(card.payWith || card.instruments.length > 0) && (
            <div className="flex gap-2">
              <CreditCard className="mt-0.5 size-3.5 shrink-0 text-fg-3" /> {card.payWith?.label ?? card.instruments.find((i) => i.selected)?.label ?? card.instruments[0]?.label} <span className="text-fg-3">(saved in Shop)</span>
            </div>
          )}
        </div>
      )}

      {(errors.length > 0 || notes.length > 0 || card.handoffReason) && (
        <div className="space-y-1.5 border-t border-line px-3.5 py-2.5">
          {card.handoffReason && (
            <div className="flex gap-2 text-[12.5px] text-accent">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {card.handoffReason}
            </div>
          )}
          {errors.map((m, i) => (
            <div key={i} className="flex gap-2 text-[12.5px] text-fg-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent" /> {m.text}
            </div>
          ))}
          {notes.map((m, i) => (
            <div key={i} className="text-[12px] text-fg-3">
              {m.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
        <Verified at={card.fetchedAt} />
        <span className="flex-1" />
        {card.links.slice(0, 3).map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-[11.5px] text-fg-3 hover:text-fg">
            {l.title}
          </a>
        ))}
        {isOrder && card.order?.url && (
          <a href={card.order.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[12.5px] font-medium shadow-1 hover:border-line-strong">
            <CheckCircle2 className="size-3.5 text-ok" /> View order
          </a>
        )}
        {cta && !compact && (
          <a href={card.continueUrl!} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-fg px-2.5 text-[12.5px] font-medium text-bg hover:bg-fg/90">
            {cta} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </motion.div>
  );
}

export function CommerceCardView({ card }: { card: CommerceCard }) {
  if (card.type === 'products') return <ProductsCard card={card} />;
  return <CartCard card={card} />;
}
