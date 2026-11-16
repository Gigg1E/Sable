import { kvGet, kvSet } from '../db.js';
import { getSettings } from '../settings.js';
import crypto from 'node:crypto';
import { truncate } from '../util.js';
import { registerTool, type Card, type ToolPreview } from '../agent/tools/registry.js';
import { shopLinkStatus } from './auth.js';
import { shopCall, ShopError, shopErrorText, type ShopMessage } from './client.js';

/**
 * Shopping via Shop MCP. The model only ever passes IDs; every price, image, total and status
 * shown to the user is built here from Shop's own responses ("verified cards"), never from the
 * model's text. Purchases always need explicit approval of a server-fetched checkout snapshot,
 * which is re-checked immediately before paying.
 */

// ───────────────────────── Money & normalization ─────────────────────────

export interface Money {
  amount: number; // minor units
  currency: string;
}

function digits(currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}
export function fmtMoney(m?: Money | null) {
  if (!m || typeof m.amount !== 'number') return 'unknown';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency }).format(m.amount / 10 ** digits(m.currency));
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}
const toMinor = (major: number, currency: string) => Math.round(major * 10 ** digits(currency));

export interface Offer {
  variantId: string;
  productId: string;
  title: string;
  options: string;
  price: Money | null;
  available: boolean | null;
  image: string | null;
  url: string | null;
  seller: { name: string; domain: string; url?: string };
  rating: { value: number; count: number } | null;
  fetchedAt: number;
}

function normalizeProducts(products: any[]): Offer[] {
  const out: Offer[] = [];
  for (const p of products ?? []) {
    for (const v of p.variants ?? []) {
      if (!v?.id || !v.seller?.domain) continue;
      out.push({
        variantId: v.id,
        productId: p.id,
        title: p.title ?? v.title ?? 'Untitled product',
        options: (v.options ?? []).map((o: any) => o.label).filter(Boolean).join(' / '),
        price: v.price && typeof v.price.amount === 'number' ? { amount: v.price.amount, currency: v.price.currency } : null,
        available: typeof v.availability?.available === 'boolean' ? v.availability.available : null,
        image: v.media?.[0]?.url ?? p.media?.[0]?.url ?? null,
        url: v.url ?? null,
        seller: { name: v.seller.name ?? v.seller.domain, domain: v.seller.domain, url: v.seller.url },
        rating: (v.rating ?? p.rating) ? { value: (v.rating ?? p.rating).value, count: (v.rating ?? p.rating).count } : null,
        fetchedAt: Date.now(),
      });
    }
  }
  return out;
}

// Offers the agent has seen recently, keyed by variant ID. Cards are built only from these.
const offers = new Map<string, Offer>();
function remember(list: Offer[]) {
  for (const o of list) offers.set(o.variantId, o);
  if (offers.size > 2000) for (const k of [...offers.keys()].slice(0, 500)) offers.delete(k);
}

async function lookupOffers(ids: string[], signal?: AbortSignal): Promise<Offer[]> {
  const s = getSettings().shopping;
  const data = await shopCall('lookup_catalog', { catalog: { ids, context: { address_country: s.country, currency: s.currency } } }, signal);
  const list = normalizeProducts(data.products ?? []);
  remember(list);
  return list;
}

/** Fresh (≤10 min) offers for these variant IDs, fetched from Shop when needed. */
async function freshOffers(ids: string[], signal?: AbortSignal): Promise<Offer[]> {
  const stale = ids.filter((i) => !offers.get(i) || Date.now() - offers.get(i)!.fetchedAt > 10 * 60_000);
  if (stale.length) await lookupOffers(stale, signal);
  return ids.map((i) => offers.get(i)).filter((o): o is Offer => !!o);
}

function offerLine(o: Offer, i?: number) {
  return `${i != null ? `[${i + 1}] ` : ''}${o.title}${o.options ? ` (${o.options})` : ''} — ${fmtMoney(o.price)}${o.available === false ? ' — OUT OF STOCK' : o.available ? ' — in stock' : ''} — sold by ${o.seller.name}${o.rating ? ` — ${o.rating.value}/5 (${o.rating.count})` : ''}\n    variant_id: ${o.variantId}  product_id: ${o.productId}\n    ${o.url ?? ''}`;
}

const warnings = (msgs?: ShopMessage[]) => (msgs ?? []).filter((m) => m && m.content).map((m) => ({ type: m.type ?? 'info', code: m.code ?? '', text: m.content! }));

// ───────────────────────── Carts & checkouts ─────────────────────────

interface StoredRef {
  id: string;
  seller: string;
  updatedAt: number;
}
const refs = (kind: 'cart' | 'checkout') => kvGet<Record<string, StoredRef>>(`shop_${kind}s`) ?? {};
const saveRef = (kind: 'cart' | 'checkout', shop: string, ref: StoredRef | null) => {
  const all = refs(kind);
  if (ref) all[shop] = ref;
  else delete all[shop];
  kvSet(`shop_${kind}s`, all);
};

/** Resolve a store from a domain or seller name the agent mentions. */
function resolveShop(kind: 'cart' | 'checkout', hint?: string): string {
  const all = refs(kind);
  const keys = Object.keys(all);
  if (!hint) {
    if (keys.length === 1) return keys[0];
    throw new Error(keys.length ? `Which store? You have ${kind}s with: ${keys.map((k) => all[k].seller).join(', ')}.` : `There is no ${kind} yet.`);
  }
  const h = hint.toLowerCase();
  const hit = keys.find((k) => k.toLowerCase() === h || all[k].seller.toLowerCase() === h || all[k].seller.toLowerCase().includes(h));
  if (!hit) throw new Error(`No ${kind} for “${hint}”. Existing: ${keys.map((k) => all[k].seller).join(', ') || 'none'}.`);
  return hit;
}

function cardFrom(kind: 'cart' | 'checkout', shop: string, sellerName: string, doc: any): Card {
  const fulfillment = doc.fulfillment?.methods ?? [];
  const method = fulfillment[0];
  const dest = method?.destinations?.find((d: any) => d.id === method?.selected_destination_id) ?? method?.destinations?.[0];
  const group = method?.groups?.[0];
  const option = group?.options?.find((o: any) => o.id === group?.selected_option_id);
  const instruments = (doc.payment?.instruments ?? []).map((i: any, n: number) => describeInstrument(i, n));
  return {
    type: kind,
    id: doc.id,
    shop,
    seller: sellerName,
    status: doc.status ?? null,
    currency: doc.currency,
    lines: (doc.line_items ?? []).map((l: any) => ({
      variantId: l.item?.id,
      title: l.item?.title ?? 'Item',
      image: l.item?.image_url ?? null,
      quantity: l.quantity,
      unitPrice: typeof l.item?.price === 'number' ? { amount: l.item.price, currency: doc.currency } : null,
      total: (() => {
        const t = (l.totals ?? []).find((x: any) => x.type === 'total') ?? (l.totals ?? []).find((x: any) => x.type === 'subtotal');
        return t ? { amount: t.amount, currency: doc.currency } : null;
      })(),
    })),
    totals: (doc.totals ?? []).map((t: any) => ({ type: t.type, label: t.display_text ?? t.type, amount: t.amount })),
    address: dest ? [dest.first_name && `${dest.first_name} ${dest.last_name ?? ''}`.trim(), dest.street_address ?? dest.address1, dest.address_locality ?? dest.city, dest.address_region ?? dest.province, dest.postal_code ?? dest.zip, dest.address_country ?? dest.country].filter(Boolean).join(', ') : null,
    shipping: option ? { title: option.title ?? option.description ?? 'Shipping', amount: (option.totals ?? []).find((t: any) => t.type === 'total')?.amount ?? null } : null,
    instruments,
    messages: warnings(doc.messages),
    links: (doc.links ?? []).filter((l: any) => l.url).map((l: any) => ({ title: l.title ?? l.type, url: l.url })),
    continueUrl: doc.continue_url ?? null,
    order: doc.order ? { id: doc.order.id, number: doc.order.name ?? doc.order.number ?? null, url: doc.order.permalink_url ?? doc.order.url ?? null } : null,
    fetchedAt: Date.now(),
  };
}

/** Display-only description of an offered payment method. The instrument itself is never shown to the model. */
function describeInstrument(i: any, index = 0) {
  const d = i?.display ?? i?.credential?.display ?? {};
  const brand = d.brand ?? d.card_brand ?? i?.brand ?? '';
  const last = d.last_digits ?? d.last4 ?? i?.last_digits ?? '';
  const kind = i?.type === 'shop_pay' || i?.handler_id === 'shop_pay' ? 'Shop Pay' : '';
  const label = [kind, brand && String(brand).replace(/_/g, ' '), last && `•••• ${last}`].filter(Boolean).join(' · ') || d.description || d.name || i?.handler_id || i?.type || 'Payment method';
  return { id: instrumentKey(i, index), label: String(label), selected: !!i?.selected };
}
const instrumentKey = (i: any, index: number) => String(i?.id ?? `${i?.handler_id ?? 'instrument'}#${index}`);

const totalOf = (doc: any): Money | null => {
  const t = (doc.totals ?? []).find((x: any) => x.type === 'total');
  return t ? { amount: t.amount, currency: doc.currency } : null;
};

/** Cart/checkout updates replace the whole document: copy current state minus the response-only fields Shop documents. */
function editable(doc: any) {
  const { next: _n, signals: _s, attribution: _a, ...rest } = structuredClone(doc);
  return rest;
}
const idem = () => ({ meta: { 'idempotency-key': crypto.randomUUID() } });

async function readCart(shop: string, signal?: AbortSignal) {
  const ref = refs('cart')[shop];
  if (!ref) return null;
  try {
    return await shopCall('get_cart', { shop, id: ref.id }, signal);
  } catch {
    saveRef('cart', shop, null); // expired or gone
    return null;
  }
}

// ───────────────────────── Tools ─────────────────────────

const enabled = () => getSettings().shopping.enabled;
const guard = () => {
  if (!enabled()) throw new Error('Shopping is turned off in Settings → Shopping.');
};

registerTool({
  name: 'shop_search',
  label: 'Shop search',
  group: 'Shopping',
  description:
    'Search products across Shopify stores (Shop catalog). Returns exact prices, stock, seller and IDs. Use the user\'s words as the query; put hard limits in max_price/size/color. Present recommendations with shop_show, never by retyping prices.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      max_price: { type: 'number', description: 'In major units of the shopping currency (e.g. 80 for $80)' },
      min_price: { type: 'number' },
      size: { type: 'string' },
      color: { type: 'string' },
      limit: { type: 'integer', description: '1-10, default 6' },
    },
    required: ['query'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Search Shop for “${a.query}”`,
  async run(a, ctx) {
    guard();
    const s = getSettings().shopping;
    const attributes = [a.size && { name: 'Size', values: [String(a.size)] }, a.color && { name: 'Color', values: [String(a.color)] }].filter(Boolean);
    const price = a.max_price != null || a.min_price != null ? { ...(a.min_price != null ? { min: toMinor(Number(a.min_price), s.currency) } : {}), ...(a.max_price != null ? { max: toMinor(Number(a.max_price), s.currency) } : {}) } : undefined;
    const data = await shopCall(
      'search_catalog',
      {
        catalog: {
          query: String(a.query),
          context: { address_country: s.country, currency: s.currency },
          ...(attributes.length || price ? { filters: { ...(attributes.length ? { attributes } : {}), ...(price ? { price } : {}) } } : {}),
          pagination: { limit: Math.min(Math.max(Number(a.limit) || 6, 1), 10) },
        },
      },
      ctx.signal,
    );
    // Enforce the user's price cap ourselves; don't rely on the catalog filter or the model.
    const capped = (o: Offer) => a.max_price == null || !o.price || o.price.currency !== s.currency || o.price.amount <= toMinor(Number(a.max_price), s.currency);
    const all = normalizeProducts(data.products ?? []);
    const list = all.filter(capped);
    remember(list);
    const dropped = all.length - list.length;
    const notes = [...warnings(data.messages).map((m) => `note: ${m.text}`), ...(dropped ? [`note: ${dropped} result(s) above the max price were removed.`] : [])].join('\n');
    if (!list.length) return `No products found.${notes ? `\n${notes}` : ''}`;
    return `${list.map(offerLine).join('\n')}${notes ? `\n${notes}` : ''}\n(${data.pagination?.total_count ?? list.length} total matches. Show picks to the user with shop_show.)`;
  },
});

registerTool({
  name: 'shop_lookup',
  label: 'Shop lookup',
  group: 'Shopping',
  description: 'Find matching Shop offers for product URLs, product/variant IDs, GTINs or UPCs (e.g. to check a link the user pasted, or compare a product found elsewhere).',
  parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Public product URLs or IDs (1-20)' } }, required: ['ids'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Look up ${(a.ids ?? []).length} product(s) on Shop`,
  async run(a, ctx) {
    guard();
    const list = await lookupOffers((a.ids as string[]).slice(0, 20), ctx.signal);
    return list.length ? list.map(offerLine).join('\n') : 'No matching offers on Shop.';
  },
});

registerTool({
  name: 'shop_product',
  label: 'Shop product',
  group: 'Shopping',
  description: 'Get a product\'s options (sizes, colors…) and the exact variant, price and stock for a chosen option combination.',
  parameters: {
    type: 'object',
    properties: {
      product_id: { type: 'string' },
      options: { type: 'object', description: 'Option name → label, e.g. {"Size": "M", "Color": "Black"}' },
    },
    required: ['product_id'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Check options for ${String(a.product_id).split('/').pop()}`,
  async run(a, ctx) {
    guard();
    const s = getSettings().shopping;
    const selected = Object.entries((a.options as Record<string, string>) ?? {}).map(([name, label]) => ({ name, label: String(label) }));
    const data = await shopCall('get_product', { catalog: { id: String(a.product_id), ...(selected.length ? { selected } : {}), context: { address_country: s.country, currency: s.currency } } }, ctx.signal);
    const product = data.product ?? data.products?.[0] ?? data;
    const list = normalizeProducts([product]);
    remember(list);
    const opts = (product.options ?? []).map((o: any) => `${o.name}: ${(o.values ?? []).map((v: any) => v.label + (v.available === false ? ' (unavailable)' : '')).join(', ')}`).join('\n');
    return `${product.title ?? ''}\nOptions:\n${opts || '(none)'}\n\nVariants:\n${list.map((o) => offerLine(o)).join('\n') || '(none returned)'}`;
  },
});

registerTool({
  name: 'shop_show',
  label: 'Show products',
  group: 'Shopping',
  description:
    'Show products to the user as verified cards (photo, exact option, live price, stock, seller, link) built from Shop data. Use this for recommendations instead of writing prices in your reply. Only variant IDs returned by Shop tools are accepted.',
  parameters: {
    type: 'object',
    properties: { variant_ids: { type: 'array', items: { type: 'string' } }, heading: { type: 'string' } },
    required: ['variant_ids'],
  },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Show ${(a.variant_ids ?? []).length} product(s)`,
  async run(a, ctx) {
    guard();
    const ids = [...new Set((a.variant_ids as string[]).map(String))].slice(0, 8);
    const list = await freshOffers(ids, ctx.signal);
    const missing = ids.filter((i) => !list.some((o) => o.variantId === i));
    if (!list.length) return 'None of those IDs matched a Shop product. Use variant_id values exactly as returned by shop_search.';
    return {
      content: `Shown to the user as cards: ${list.map((o) => `${o.title} (${fmtMoney(o.price)})`).join('; ')}.${missing.length ? ` Not found: ${missing.join(', ')}.` : ''} Don't repeat these prices in prose; refer to the cards.`,
      cards: [{ type: 'products', heading: a.heading ? truncate(String(a.heading), 80) : null, items: list, source: 'Shop' }],
    };
  },
});

registerTool({
  name: 'shop_cart_add',
  label: 'Add to cart',
  group: 'Shopping',
  description: 'Add a product variant to that store\'s cart (one cart per store). Only when the user asks to add/save it. Nothing is purchased.',
  parameters: { type: 'object', properties: { variant_id: { type: 'string' }, quantity: { type: 'integer' } }, required: ['variant_id'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Add ${a.quantity ?? 1} × item to cart`,
  async run(a, ctx) {
    guard();
    const [offer] = await freshOffers([String(a.variant_id)], ctx.signal);
    if (!offer) throw new Error('Unknown variant. Use a variant_id returned by shop_search or shop_product.');
    if (offer.available === false) throw new Error(`${offer.title}${offer.options ? ` (${offer.options})` : ''} is out of stock.`);
    const qty = Math.max(1, Math.min(Number(a.quantity) || 1, 20));
    const shop = offer.seller.domain;
    const current = await readCart(shop, ctx.signal);
    let cart: any;
    if (current) {
      const doc = editable(current);
      const line = (doc.line_items ?? []).find((l: any) => l.item?.id === offer.variantId);
      if (line) line.quantity += qty;
      else doc.line_items = [...(doc.line_items ?? []), { item: { id: offer.variantId }, quantity: qty }];
      cart = await shopCall('update_cart', { shop, id: current.id, cart: doc, ...idem() }, ctx.signal);
    } else {
      cart = await shopCall('create_cart', { shop, cart: { line_items: [{ item: { id: offer.variantId }, quantity: qty }] }, ...idem() }, ctx.signal);
    }
    saveRef('cart', shop, { id: cart.id, seller: offer.seller.name, updatedAt: Date.now() });
    return {
      content: `Added ${qty} × ${offer.title}${offer.options ? ` (${offer.options})` : ''} to the ${offer.seller.name} cart. Cart total: ${fmtMoney(totalOf(cart))}. The user sees the cart card.`,
      cards: [cardFrom('cart', shop, offer.seller.name, cart)],
    };
  },
});

registerTool({
  name: 'shop_cart_update',
  label: 'Update cart',
  group: 'Shopping',
  description: 'Change the quantity of an item in a store cart; quantity 0 removes it.',
  parameters: { type: 'object', properties: { variant_id: { type: 'string' }, quantity: { type: 'integer' }, store: { type: 'string' } }, required: ['variant_id', 'quantity'] },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => (Number(a.quantity) === 0 ? 'Remove item from cart' : `Set quantity to ${a.quantity}`),
  async run(a, ctx) {
    guard();
    const shop = a.store ? resolveShop('cart', String(a.store)) : (offers.get(String(a.variant_id))?.seller.domain ?? resolveShop('cart'));
    const current = await readCart(shop, ctx.signal);
    if (!current) throw new Error('That cart no longer exists.');
    const doc = editable(current);
    const line = (doc.line_items ?? []).find((l: any) => l.item?.id === a.variant_id);
    if (!line) throw new Error('That item is not in the cart.');
    if (Number(a.quantity) <= 0) doc.line_items = doc.line_items.filter((l: any) => l !== line);
    else line.quantity = Math.min(Number(a.quantity), 20);
    const cart = await shopCall('update_cart', { shop, id: current.id, cart: doc, ...idem() }, ctx.signal);
    const seller = refs('cart')[shop]?.seller ?? shop;
    return { content: `Cart updated. Total: ${fmtMoney(totalOf(cart))}.`, cards: [cardFrom('cart', shop, seller, cart)] };
  },
});

registerTool({
  name: 'shop_cart_view',
  label: 'View carts',
  group: 'Shopping',
  description: 'Show the user their current Shop carts (one per store) with live totals.',
  parameters: { type: 'object', properties: {} },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: () => 'Show carts',
  async run(_a, ctx) {
    guard();
    const all = refs('cart');
    const cards: Card[] = [];
    const lines: string[] = [];
    for (const shop of Object.keys(all)) {
      const cart = await readCart(shop, ctx.signal);
      if (!cart) continue;
      cards.push(cardFrom('cart', shop, all[shop].seller, cart));
      lines.push(`${all[shop].seller}: ${(cart.line_items ?? []).length} item(s), total ${fmtMoney(totalOf(cart))}`);
    }
    return cards.length ? { content: lines.join('\n'), cards } : 'No carts yet.';
  },
});

registerTool({
  name: 'shop_checkout',
  label: 'Prepare checkout',
  group: 'Shopping',
  description:
    'Prepare a checkout for a store\'s cart (fills the linked Shop account\'s contact details and saved address, and picks the cheapest shipping). Does NOT buy anything; shows the user a checkout card with the exact total. Only when the user wants to check out.',
  parameters: { type: 'object', properties: { store: { type: 'string', description: 'Store name or domain (optional if only one cart)' } } },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Prepare checkout${a.store ? ` at ${a.store}` : ''}`,
  async run(a, ctx) {
    guard();
    const shop = resolveShop('cart', a.store ? String(a.store) : undefined);
    const seller = refs('cart')[shop]?.seller ?? shop;
    const cart = await readCart(shop, ctx.signal);
    if (!cart?.line_items?.length) throw new Error('That cart is empty or expired.');
    // Check out the cart itself, as Shop documents.
    let co = await shopCall('create_checkout', { shop, checkout: { cart_id: cart.id, line_items: [], context: { address_country: getSettings().shopping.country } }, ...idem() }, ctx.signal);

    // Signed in: copy the preferred saved address unchanged into delivery, then choose the cheapest
    // delivery option. (Shop: never type or change address fields; account email is display-only.)
    if (shopLinkStatus().linked && co.status === 'incomplete') {
      try {
        const account = await shopCall('get_account', {}, ctx.signal);
        const addresses: any[] = account.addresses ?? [];
        const addr = addresses.find((x) => x.id === account.preferred_address_id) ?? addresses[0];
        const doc = editable(co);
        const methods: any[] = doc.fulfillment?.methods ?? [];
        if (addr && methods.length) {
          const m = methods.find((x) => x.type === 'shipping') ?? methods[0];
          m.destinations = [...(m.destinations ?? []).filter((d: any) => d.id !== addr.id), addr];
          m.selected_destination_id = addr.id;
          co = await shopCall('update_checkout', { shop, id: co.id, checkout: doc, ...idem() }, ctx.signal);
        }
        const doc2 = editable(co);
        let changed = false;
        for (const m of doc2.fulfillment?.methods ?? []) {
          for (const g of m.groups ?? []) {
            if (!g.selected_option_id && g.options?.length) {
              const amt = (o: any) => (o.totals ?? []).find((t: any) => t.type === 'total')?.amount ?? Number.MAX_SAFE_INTEGER;
              g.selected_option_id = [...g.options].sort((x: any, y: any) => amt(x) - amt(y))[0].id;
              changed = true;
            }
          }
        }
        if (changed) co = await shopCall('update_checkout', { shop, id: co.id, checkout: doc2, ...idem() }, ctx.signal);
      } catch (err) {
        // Keep whatever state Shop has; the card shows what's missing and links to the store.
        if (!(err instanceof ShopError)) throw err;
      }
    }
    saveRef('checkout', shop, { id: co.id, seller, updatedAt: Date.now() });
    const card = cardFrom('checkout', shop, seller, co);
    const ready = co.status === 'ready_for_complete';
    return {
      content: `Checkout prepared at ${seller}: status ${co.status}, total ${fmtMoney(totalOf(co))}.${ready ? ' Ready: if the user wants to buy, call shop_buy (they will be asked to approve).' : ` Not ready: ${warnings(co.messages).map((m) => m.text).join(' ') || 'details missing'}. The user can finish on the store via the checkout card.`}`,
      cards: [card],
    };
  },
});

async function snapshot(shop: string, signal?: AbortSignal) {
  const ref = refs('checkout')[shop];
  if (!ref) throw new Error('No prepared checkout for that store. Call shop_checkout first.');
  const co = await shopCall('get_checkout', { shop, id: ref.id }, signal);
  return { co, card: cardFrom('checkout', shop, ref.seller, co), seller: ref.seller };
}

registerTool({
  name: 'shop_buy',
  label: 'Place order',
  group: 'Shopping',
  description:
    'Place the order for a prepared checkout using the payment method saved in the user\'s Shop account. The user always sees the exact checkout and must approve; you cannot skip this. Call only after the user clearly says to buy.',
  parameters: { type: 'object', properties: { store: { type: 'string', description: 'Store name or domain (optional if only one checkout)' } } },
  risk: 'high',
  defaultPolicy: 'ask',
  alwaysAsk: true,
  summarize: (a) => `Place order${a.store ? ` at ${a.store}` : ''}`,
  async preview(a, ctx): Promise<ToolPreview> {
    guard();
    const s = getSettings().shopping;
    const shop = resolveShop('checkout', a.store ? String(a.store) : undefined);
    const { co, card, seller } = await snapshot(shop, ctx.signal);
    const handoff = (why: string): ToolPreview => ({
      refuse: `${why} Nothing was charged. Give the user the store checkout link from the card so they can finish there.`,
      cards: [{ ...card, handoffReason: why }],
    });
    if (!s.purchases) return handoff('Purchases by the agent are turned off (Settings → Shopping).');
    if (!shopLinkStatus().linked) return handoff('No Shop account is linked, so there is no saved payment method.');
    if (co.status !== 'ready_for_complete') return handoff(`The checkout isn't ready (${co.status}): ${warnings(co.messages).map((m) => m.text).join(' ') || 'details are missing'}.`);
    if (!(co.payment?.instruments ?? []).length) return handoff('The store offered no saved payment method for this checkout. Add a card in the Shop app, or pay on the store.');
    const total = totalOf(co);
    if (!total) return handoff('Shop did not return a total for this checkout.');
    if (total.currency === s.currency && total.amount > toMinor(s.maxOrder, s.currency)) {
      return handoff(`The total ${fmtMoney(total)} is above your per-order limit of ${fmtMoney({ amount: toMinor(s.maxOrder, s.currency), currency: s.currency })}.`);
    }
    return {
      summary: `Place order with ${seller}: ${fmtMoney(total)}`,
      // The user picks one of these in the approval; nothing is preselected.
      card: { ...card, confirm: true },
    };
  },
  async run(_a, ctx) {
    const approved = ctx.approved?.card as any;
    if (!approved) throw new Error('No approved checkout.');
    const shop = approved.shop as string;
    // Re-read right before paying: if anything changed since the user approved, stop.
    const { co } = await snapshot(shop, ctx.signal);
    const now = cardFrom('checkout', shop, approved.seller, co) as Card & { lines: any[] };
    const total = totalOf(co);
    const sameLines = JSON.stringify(now.lines.map((l: any) => [l.variantId, l.quantity])) === JSON.stringify(approved.lines.map((l: any) => [l.variantId, l.quantity]));
    const approvedTotal = (approved.totals as any[]).find((t) => t.type === 'total')?.amount;
    const offered: any[] = co.payment?.instruments ?? [];
    const idx = offered.findIndex((x, n) => instrumentKey(x, n) === ctx.choice);
    const instrument = idx >= 0 ? offered[idx] : null;
    if (!sameLines || !total || total.amount !== approvedTotal || !instrument || co.status !== 'ready_for_complete') {
      return {
        content: `Stopped: the checkout changed after the user approved it (now ${fmtMoney(total)}, status ${co.status}${instrument ? '' : ', chosen payment method no longer offered'}). Nothing was charged. Ask the user to review the new checkout.`,
        cards: [now],
      };
    }
    let result: any;
    try {
      // Never retried: a repeated completion could double-charge.
      // The chosen instrument is copied exactly as Shop returned it, with selected: true.
      result = await shopCall('complete_checkout', { shop, id: co.id, checkout: { payment: { instruments: [{ ...instrument, selected: true }] } } }, ctx.signal);
    } catch (err) {
      // Reconcile by reading, never by completing again.
      try {
        result = await shopCall('get_checkout', { shop, id: co.id });
      } catch {
        throw new Error(`The purchase isn't confirmed (${shopErrorText(err)}). Do not try again or start a new checkout; tell the user to check the Shop app or their email, and give them the store checkout link.`);
      }
    }
    const card = cardFrom('checkout', shop, approved.seller, result);
    if (result.status === 'completed' && result.order) {
      saveRef('checkout', shop, null);
      saveRef('cart', shop, null);
      return { content: `Order placed with ${approved.seller}${card.order && (card.order as any).number ? ` (${(card.order as any).number})` : ''}. Total ${fmtMoney(totalOf(result))}.`, cards: [{ ...card, type: 'order' }] };
    }
    if (result.status === 'requires_escalation') {
      return { content: `The store needs one more step from the user (e.g. verification). Point them to the checkout link on the card. Not yet purchased.`, cards: [card] };
    }
    return { content: `The order was not completed (status ${result.status}). ${warnings(result.messages).map((m) => m.text).join(' ')} Nothing is confirmed as purchased.`, cards: [card] };
  },
});

registerTool({
  name: 'shop_orders',
  label: 'Shop orders',
  group: 'Shopping',
  description: 'Look up orders and shipments tracked in the linked Shop account (in-progress by default; status "all" for history).',
  parameters: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string', enum: ['in_progress', 'all'] } } },
  risk: 'low',
  defaultPolicy: 'auto',
  summarize: (a) => `Check Shop orders${a.query ? ` for “${a.query}”` : ''}`,
  async run(a, ctx) {
    guard();
    if (!shopLinkStatus().linked) return 'No Shop account is linked. The user can link one in Settings → Shopping.';
    const data = await shopCall('search_orders', { orders: { ...(a.query ? { query: String(a.query) } : {}), ...(a.status === 'all' ? { filters: { status: 'all' } } : {}) } }, ctx.signal);
    return truncate(JSON.stringify(data.orders ?? data, null, 1), 8000);
  },
});

/** Used by watchers: live price/stock for one variant. */
export async function shopVariantSnapshot(variantId: string, signal?: AbortSignal) {
  const [o] = await lookupOffers([variantId], signal);
  if (!o) throw new Error('Shop no longer lists that product variant.');
  return o;
}
