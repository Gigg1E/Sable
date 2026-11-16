# Hosting Sable on your domain (safely, for more than one person)

This guide covers three things:

1. How to put Sable on a subdomain of a domain that already hosts your website, without exposing either one.
2. How to run a separate Sable for someone else on the same subdomain, with nothing shared or mixed up.
3. How to keep the Shop (Shopify) connection safe.

Everything here uses the files in [`deploy/`](../deploy).

---

## The short version

- **The public subdomain is only a front.** Anyone who visits it sees a blank page. The only other thing it serves is each person's webhook URLs, behind a long random path. No login page, no app, no API and no Shop data are ever reachable from it.
- **The real Sable apps stay private.** Each one listens on `127.0.0.1` on your server only. You (and the other person) reach your own app over **Tailscale**, a private network that only your devices can join.
- **Shop never needs to reach your server.** Sable calls Shop; Shop never calls Sable. So Shop works the same with the front, without it, or with nothing public at all.
- **Each person gets their own container.** That means their own database, password, 2FA, Shop account, API keys and login cookie. Instances can't read each other's data, and a login on one doesn't work on another.

```
                    Internet
                       │
          front.example.com  (Caddy, HTTPS)
          ├── /                      → blank page (served by Caddy itself)
          ├── /<slug-A>/hooks/<id>   → Sable A, webhook listener only
          ├── /<slug-B>/hooks/<id>   → Sable B, webhook listener only
          └── anything else          → 404
                       │
     ───────────── your server ─────────────
       Sable A  127.0.0.1:8787  ◄── Tailscale ── your phone / laptop
       Sable B  127.0.0.1:8789  ◄── Tailscale ── their phone / laptop
       Ollama   (internal only; stores no chats)
                       │
                  outbound only
                       ▼
       Shop, Claude, OpenAI, web search… (optionally via a VPN)
```

### Why a front at all?

You only need a public address for **inbound webhooks**: other services (GitHub, Home Assistant, Zapier and so on) calling Sable to wake it up. If you don't use webhooks, you can skip the front entirely and run Sable on Tailscale only. That's the safest setup.

The front exists so webhooks have somewhere to land, without putting the app itself on the internet.

### Your main website

Your existing site is untouched. The front is a **subdomain** with its own DNS record (it can point to a different machine than your main site). Sable's cookies are host-only (`__Host-` prefix), so they're never sent to your main site or to any other subdomain. Sable also rejects requests that come from a sibling subdomain (it blocks `same-site` as well as `cross-site`), so a problem on `www.example.com` can't be used to act on Sable.

**Don't** run Sable under a path of your main site (like `example.com/sable`). Both would share one origin, and a bug on either one could reach the other.

---

## Setup

### 1. DNS

Create an `A` record (and `AAAA` if you have IPv6) for your front subdomain, for example `front.example.com`, pointing at the server that runs Docker. Pick a boring name. It doesn't need to say "sable" or "ai".

Open ports **80 and 443** on that server (Caddy needs 80 for the HTTPS certificate). **Don't** open 8787, 8788 or 8789.

### 2. Configure

```bash
cd deploy
cp .env.example .env
openssl rand -hex 12     # run twice: one slug per person
$EDITOR .env
```

```ini
FRONT_DOMAIN=front.example.com
FRONT_TITLE=Hello               # the only text on the blank page
SLUG_A=3f9c0e7a1b2d4c6e8f0a1b2c # person A's secret path
SLUG_B=9a8b7c6d5e4f3a2b1c0d9e8f # person B's secret path
TZ=America/Chicago
```

The slugs are part of every webhook URL. Treat them like passwords and don't reuse the examples.

### 3. Start

```bash
docker compose up -d
docker compose exec ollama ollama pull qwen3:8b
```

Visiting `https://front.example.com` should show a blank page with your title. `https://front.example.com/api/auth/status` should return **404**.

### 4. Reach your own app privately (Tailscale)

Install [Tailscale](https://tailscale.com) on the server and on your devices, then publish each app **on the tailnet only**:

```bash
sudo tailscale serve --bg --https=443  http://127.0.0.1:8787   # person A
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8789   # person B
```

- Person A opens `https://<server>.<tailnet>.ts.net`
- Person B opens `https://<server>.<tailnet>.ts.net:8443`

These addresses only work for devices on your tailnet. To give the other person access to **only their** app, [share the server node](https://tailscale.com/kb/1084/sharing) with them. Then use a Tailscale ACL that lets them reach port 8443 and nothing else:

```jsonc
// Tailscale admin → Access controls
{ "action": "accept", "src": ["their-login@example.com"], "dst": ["your-server:8443"] }
```

Both apps can be installed to the home screen and receive push notifications, because Tailscale gives them real HTTPS.

> **Prefer a public login page instead of Tailscale?** You can put the app on its own subdomain behind **Cloudflare Access** (or another identity-aware proxy) and keep Sable's own password and 2FA as a second layer. Never expose port 8787 directly.

### 5. First login (each person)

1. Open your app and choose a **long, unique password**.
2. Go to **Settings → Security** and turn on **two-factor authentication**. Scan the QR code with an authenticator app and **save the recovery codes** somewhere safe.
3. In **Settings → Webhooks**, the webhook URLs already start with `https://front.example.com/<your-slug>/hooks/…`. (This comes from `SABLE_PUBLIC_URL` in the compose file.)

### Signing in to accounts (Google, Notion, your own Shop app…)

The "return address" (redirect URI) that Google and others send you back to after sign-in is a **browser redirect**. Their servers never contact it, so it does **not** go on the public front. It's the private address you open Sable at, for example:

```
https://<server>.<tailnet>.ts.net/api/mcp/oauth/callback
```

Settings → Connectors shows the exact one. Paste it into your Google OAuth client's **Authorized redirect URIs**, and always sign in from that same address. Google only accepts `https` with a real domain name (Tailscale's `ts.net` works) or `http://localhost`. Plain IPs such as `http://192.168.1.20:8787` or `100.x.x.x` are refused. Each person registers their own address (person B's ends in `:8443`).

---

## More than one person, one subdomain

Each person is a separate `sable-x` service in `deploy/docker-compose.yml`, so nothing gets mixed up:

| Kept separate per person | How |
|---|---|
| Chats, memory, spaces, files, settings | Own Docker volume (`sable-a`, `sable-b`) and own database |
| Password, 2FA, recovery codes | Stored in that person's database only |
| Login | Each instance names its cookie after a random instance ID (`__Host-sable-<id>`), and session tokens are only stored as hashes. A login on A is useless on B, even on the same browser. |
| Shop account and orders | Each person links their own Shop account. The token lives in their own volume. |
| API keys (Claude, OpenAI…) | Set separately in each app's settings |
| Webhooks | Each person's secret slug routes only to their container. A's webhook sent through B's slug gets a 404. |
| Notifications | Each app has its own push keys and channels |

**Shared:** only the Ollama model server, which runs models and doesn't store conversations. If you'd rather not share it, give each person their own `ollama` service, or point one of them at Claude/OpenAI instead.

### Adding a third person

1. Copy the `sable-b` block in `docker-compose.yml` to `sable-c`. Give it the next free private port (`127.0.0.1:8790:8787`), a new volume `sable-c` and `SABLE_PUBLIC_URL: https://${FRONT_DOMAIN}/${SLUG_C}`. Add `sable-c:` under `volumes:`.
2. Add `SLUG_C: ${SLUG_C}` to Caddy's `environment`, and `SLUG_C=...` to `.env`.
3. In the `Caddyfile`, copy the person B block with `SLUG_C` and `sable-c`.
4. Run `docker compose up -d`, then `tailscale serve --bg --https=10000 http://127.0.0.1:8790`.

### Removing someone

```bash
docker compose rm -sf sable-b
docker volume rm sable_sable-b     # deletes their data for good — back it up first if needed
```

Then remove their block from the `Caddyfile` and their `tailscale serve` port.

---

## Keeping Shop secure

How Sable handles Shop by design:

- **Outbound only.** Sable talks to Shop's servers. Nothing at Shop ever connects to your domain, so the front subdomain doesn't help or hurt Shop at all.
- **No card numbers, ever.** Sable never sees or stores card numbers. Payment uses the cards saved in your Shop account (Shop Pay), and Shop handles them.
- **The token stays on the server.** The Shop login token is stored in your instance's database. It's never sent to the browser or to any model provider.
- **Purchases are off by default.** Search and adding to cart work right away. Buying needs **Settings → Shopping → Allow purchases** turned on, and then **every** order still asks you first. The confirmation shows the real items, total and card from Shop.
- **Spending cap.** **Max order** rejects any checkout above the limit before you're even asked.
- **Re-checked before paying.** Right before checkout, Sable re-reads the cart from Shop. If the total changed after you approved, it stops.
- **Real data only.** Product names, prices and photos shown in chat come from Shop's responses, not from the model.

What you should do:

1. **Turn on 2FA** (Settings → Security). Your Sable password is the only thing standing between someone and your linked Shop account.
2. **Leave purchases off** until you want them, and **set a low max order** (for example, your usual order size).
3. **Keep the app private** (Tailscale). Only the front is public, and it can't reach Shop or your data.
4. **One Shop account per person.** Each person links their own account in their own instance. Never link your account in someone else's Sable.
5. **If you think something's wrong:** in Settings → Shopping, click **Unlink**. Also remove Sable from your connected apps at [shop.app](https://shop.app) (account settings), and use **Settings → Security → Sign out everywhere else**.
6. **Optional: VPN for outbound traffic.** If you don't want Shop and stores to see your server's IP, route agent traffic through the VPN option in the README ([Routing agent traffic through a VPN](../README.md#routing-agent-traffic-through-a-vpn-docker)).

---

## What Sable does to protect itself

These are on by default:

- **Two-factor authentication** (authenticator app codes, plus single-use recovery codes). Each code can only be used once.
- **Login rate limits:** 10 failed attempts per IP per 15 minutes, plus a global limit of 30 per minute.
- **Hashed sessions:** session tokens are stored only as SHA-256 hashes. **Sign out everywhere else** ends every other session.
- **Cross-site request blocking:** any request that changes data must come from Sable's own page. Other sites and sibling subdomains get a 403.
- **Strict Content Security Policy:** the app only runs its own scripts and only talks to its own server.
- **Sandboxed spaces:** pages the agent builds run on their own URL in a sandbox with no network access. They can't read your session, call the API or send your data anywhere.
- **Public front:** only the blank page and webhooks. Unknown webhook IDs get 404, and webhooks support HMAC signatures.
- **Container hardening:** runs as the unprivileged `node` user with `no-new-privileges`. App code is read-only, and only `/data` is writable.
- **Private ports:** apps listen on `127.0.0.1` only, so the firewall doesn't even need to block them.

## Checklist

- [ ] Ports 8787/8788/8789 are **not** open in your firewall or router (only 80 and 443 for Caddy).
- [ ] Each person has a long, unique password **and 2FA on**, with recovery codes saved.
- [ ] Slugs are random (`openssl rand -hex 12`), not the examples.
- [ ] Shopping: purchases off unless needed, and a sensible max order.
- [ ] Your main website is kept patched. It's separate, but it's the same domain name.
- [ ] Back up the volumes regularly:
      `docker run --rm -v sable_sable-a:/d -v $PWD:/b alpine tar czf /b/sable-a.tgz -C /d .`
- [ ] Update now and then: `git pull && docker compose up -d --build`.
- [ ] If a webhook URL leaks, delete that webhook in Settings and create a new one. If a slug leaks, change it in `.env` and restart.
