# Sable

**A self-hosted personal AI agent you reach through the web.** Sable lives on your own server: it plans multi-step jobs, uses tools, works in the background on a schedule, remembers what matters, and builds small apps ("Spaces") for you. You stay in control: anything sensitive waits for your approval, and every action is logged.

It runs on **Ollama**, **llama.cpp**, **Claude** or **OpenAI** (or any OpenAI-compatible server). You can mix them: for example, a local Ollama model as the main agent that hands coding jobs to a Claude sub-agent.

The web app installs on phones and desktops (PWA), with push notifications for approvals and finished background work.

> Inspired by the feature set of Meta's Muse personal agent (see [`docs/muse-research.md`](docs/muse-research.md)). Sable is its own product with its own design, and is self-hosted by design.

![Sable home](docs/screenshots/home.png)

![Approval before running a script](docs/screenshots/approval.png)

![Sable on a phone](docs/screenshots/mobile.png)

---

## Features

| | |
|---|---|
| **Chat with goals** | Chats get a short generated name ("Essay help: Brian Christian") instead of your first message, and a name you set yourself is never overwritten. Describe an outcome. The agent makes a plan (a *goal* with steps), works through it with tools, and reports back. Turns read top to bottom: what the agent says, a folded row for each batch of steps ("Searched the web and read 3 pages"), the cards it shows, then the answer. |
| **Side panel** | The panel button in a chat's top bar opens a side panel with tabs: **Files** (everything in the chat's folder; read documents rendered, view images, copy, download), **Reminders** (upcoming routines and watchers) and a tab for each **Space** the chat built, plus any space you **pin** (pinned spaces show in every chat). It opens by itself when the agent makes a file, space or reminder (you can turn that off at the bottom of the panel), can be resized by dragging its edge, and goes full screen. Hide the left sidebar with its button or **Ctrl/⌘+\\** for more room. |
| **Queue and interject** | While the agent works, **Enter** queues your next message (queue several; each one is sent after the previous task fully finishes, and you can remove them). **Ctrl/⌘+Enter** interjects instead: the message joins the running task at its next step (after the current thought or tool call) without cancelling it. On phones, use the buttons next to the message box. |
| **Connections it builds itself** | Ask about an account with an API it can't reach yet (AWS, GitHub, Cloudflare, your router…) and it researches the official docs, proposes a connection for you to approve, and tells you what key to create. Keys are encrypted, never shown to the AI, and only sent to that connection's server; reading runs freely, changes ask. **[docs/connections.md](docs/connections.md)** |
| **Math and graphs** | Math in replies is typeset (KaTeX), whichever way the model writes it: `$…$`, `$$…$$`, `\(…\)` or `\[…\]` (the style Qwen and most local models use). Prices like "$5 and $10" stay plain text. For functions, sequences, curves and points the agent draws an **interactive graph**: pan, zoom, drag points (optionally locked onto a curve), move sliders to change parameters, hide lines, and expand to full screen. **[docs/math-and-graphs.md](docs/math-and-graphs.md)** |
| **Library** | One shared store every chat and sub-agent can search: pages Sable read, files it made in chats, your uploads and notes. Search works by words now, and by meaning once the helper model is installed. Each item is **open** or **private**: anything with personal details (email, phone, address, ID or card numbers), secrets, or that you uploaded is private, and cloud models only see it with those details removed. You can flip any item, and **Forget** removes it and its search index for good. Sable checks the Library before researching again ("how did I do X?"). |
| **Files, links and pictures** | Attach any file (up to 25 MB). Files the agent writes appear as **live file cards** that update as it edits them, with preview, copy and download. Link cards (title, picture, price) and pictures are read from the real pages and shown right where they come up. Sources appear as small chips, and code blocks, tool steps and answers have copy buttons. |
| **Watchers & webhooks** | Track prices, restocks, pages or APIs on a schedule without spending model calls, and get one alert when your condition is met. Inbound webhook URLs let GitHub, Home Assistant and others notify you or wake the agent. Alerts can also go to ntfy, Discord or Slack. |
| **Background work** | Runs live on the server, not in your browser tab. Close the app and the work continues. **Reminders** go off once at the time you said and then disappear ("remind me about class at 10:30"). **Routines** run on a schedule (once, every N minutes, daily, weekly). |
| **Approvals (the Sentinel)** | Every tool call goes through a policy check: *Auto*, *Ask* or *Off*, per tool. Web access is approved per domain ("Always allow example.com"). Approvals show up in the chat, in the Inbox and as push notifications. |
| **Activity log** | A complete, searchable record of every action each agent took, approved, or was blocked from taking. |
| **Sub-agents** | Configurable specialists, each with its own provider, model, effort and toolset, plus a built-in **Helper** on the main model. Sable can run **several at once** and run long ones **in the background**: each is watched until it finishes and its result comes back into the chat. Every sub-agent gets a live card showing its task, steps and result. The defaults are a **Coder** (Claude, with files and scripts) and a **Researcher** (Ollama, with web search and fetch). |
| **Memory** | The agent saves lasting facts about you. You can see, edit and delete every one, and tell it to forget. |
| **Spaces** | Ask for a tracker, dashboard, planner or board, and the agent builds a sandboxed mini-app that saves its own data and can ask the agent questions. |
| **Connectors** | Plug in any **MCP server** (email, calendar, notes, GitHub, Home Assistant…). Connector actions ask for approval until you allow them. |
| **Tools** | Web search (DuckDuckGo or your SearXNG), page reading, HTTP/API requests, a sandboxed workspace folder, Python/Node/Bash scripts, notifications, schedules, goals, memory, spaces, delegation. |
| **Built like a tool** | A ⌘K command palette, a live status bar (connection, model, outbound route, running jobs), keyboard-first chat, and light and dark themes. Installs as an app on iOS, Android and desktop. |

## Lessons designed in

Muse's launch surfaced real problems. Sable avoids them on purpose:

- **Agents say they're agents.** Web requests use the user agent `SableAgent/0.1 (+self-hosted personal AI agent; automated)`. The system prompt forbids claiming to be human.
- **No public share links.** Nothing is shareable by URL, and everything sits behind your password.
- **Explicit scopes.** Connectors and sensitive tools ask first. File and script tools are confined to a workspace folder. Scripts run with a stripped environment, so your API keys never reach them.
- **Approval fatigue is tunable.** "Always allow" is scoped (one tool, or one domain), so you trust what you choose and nothing more.
- **Prompt-injection hygiene.** Web, connector and file content is wrapped as `<untrusted>` data that the agent is told never to obey.
- **Secrets stay server-side.** API keys are masked in the UI and never sent to the browser or to the model.
- **Spaces are sandboxed.** They run in an iframe with no same-origin access, and a CSP blocks all network calls except two script CDNs.

---

## Quick start

Requires **Node.js 22.5+** (uses the built-in SQLite).

```bash
# 1. A local model (any tool-capable model works: qwen3, llama3.1, mistral-nemo, gpt-oss…)
ollama pull qwen3:8b

# 2. Sable
npm install
npm run build
npm start            # → http://localhost:8787
```

Open the page and choose a password. Then go to **Settings → Models** to pick your main model. If you leave it on auto, Sable uses the first model Ollama reports.

### Docker

```bash
docker compose up -d                                      # Sable + Ollama
docker compose exec ollama ollama pull qwen3:8b
```

Data (database, workspace, keys) lives in the `sable-data` volume. The container runs as an unprivileged user, and the port is bound to `127.0.0.1` only.

**On your own domain, or for more than one person:** use [`deploy/`](deploy) and follow **[docs/hosting-securely.md](docs/hosting-securely.md)**. The public subdomain shows only a blank page plus each person's secret webhook paths. Each person's app stays private (Tailscale), with its own container, data, login and Shop account.

### Development

```bash
npm run dev          # API on :8787 (auto-reload) + Vite on :5173 with HTTP proxying
```

How routines, watchers, webhooks and Spaces fit together (and what needs your approval): **[docs/automations.md](docs/automations.md)**. Where Sable is headed next (Android app, Telegram, voice, Spaces as full apps): **[docs/roadmap.md](docs/roadmap.md)**.

## Watchers, webhooks and notification channels

### Watchers: “tell me when this changes”

Ask in chat, e.g. *“Watch this product and tell me if it drops under $200”*, *“Let me know when the PS6 is back in stock at Best Buy”*, *“Alert me if this status page changes”*. The agent finds the page and checks it can read the value (`watch_test`), then creates a **watcher** (`watch_create`). You can also build one by hand under **Watchers → New watcher**, with a live *Test extraction* button.

Watchers run on the server and **don't use the model on each check**. Every check fetches the page through the agent's network path (so the VPN applies), extracts one value, and compares it with the last one:

| Reads | How |
|---|---|
| **Product price** | The structured data shops publish for search engines: schema.org `Product`/`Offer` JSON-LD (including `@graph` and variants), OpenGraph `product:price:*`, and microdata `itemprop="price"`. Also reports stock status. Works on most product pages with no setup. |
| **CSS selector** | Text or an attribute of the first matching element |
| **JSON path** | e.g. `data.items[0].price` for APIs |
| **Pattern** | Regex; the first capture group is the value |
| **Page text** | Whole page or a selector, for any change |
| **AI extraction** | The main model reads the page with your instruction. A last resort, since it costs a model call per check. |

Conditions are **edge-triggered**, so you get one alert when the condition becomes true, not one every hour while it stays true. They are: *changes*, *drops below* / *rises above* a value, *falls* / *rises by N %*, *contains* / *stops containing* text. When one fires, Sable can push a notification, POST JSON to a webhook of yours (`{ watcher, previous, current, numeric, reason, ts }`), and/or wake the agent with an instruction such as *“check two other shops and tell me if this is the best price”*. Price history is kept and charted. Failing pages back off exponentially, and you get one alert after three failures in a row.

### Inbound webhooks: “wake me when something happens elsewhere”

**Webhooks → New webhook** (or ask: *“ping me when my GitHub build fails”*) creates a private URL:

```
https://your-sable.example.com/hooks/<id>/<256-bit token>
```

Any service can `POST` JSON, form data or text to it, or simply `GET` it with query parameters. Each call can:
- push a notification, with an optional title template like `Build {{body.workflow_run.conclusion}}: {{body.repository.name}}`
- wake the agent with your instruction. The payload is attached as untrusted data, and sensitive actions still need your approval.

Security: the token is compared in constant time. Optional **HMAC-SHA256 signatures** are checked over the raw body: GitHub's `X-Hub-Signature-256`, or a generic `X-Signature-256: sha256=<hex>`. Duplicate deliveries (`X-GitHub-Delivery`, `Idempotency-Key`) are ignored. Bodies are capped at 256 KB and each hook allows 60 calls a minute. Unknown hooks and wrong tokens get the same 404. Every delivery is logged, rejected ones included, and you can rotate a URL at any time.

```bash
curl -X POST 'https://your-sable.example.com/hooks/h_…/…' \
  -H 'Content-Type: application/json' \
  -d '{"message": "Nightly backup finished", "status": "ok"}'
```

**Exposing only webhooks to the internet.** If Sable itself is private (Tailscale/VPN), publish just `/hooks/*`. With Caddy:

```
hooks.example.com {
    handle /hooks/* {
        reverse_proxy localhost:8787
    }
    respond 404
}
```

Then set **Settings → Network → Public URL** to `https://hooks.example.com` so the URLs Sable shows use it. With Tailscale you can use `tailscale funnel --set-path /hooks 8787`. If you don't set a Public URL, Sable uses the address you last opened it from.

### Notification channels

**Settings → Notifications → Channels** sends alerts to **ntfy** (free push app, self-hostable), **Discord**, **Slack** or any **generic webhook** (JSON `{ source, title, body, link, ts }`), alongside browser push. Each channel can receive just the important events (approvals, watcher alerts, webhooks, agent messages) or everything. Channel URLs contain secrets, so they're masked in the UI.

## Routing agent traffic through a VPN (Docker)

When the agent searches, reads pages or calls APIs, those sites see the IP address of the machine Sable runs on. If that's your home connection or a server you'd rather not expose, send **only the agent's outreach traffic** through a VPN. The web UI, Ollama and the model APIs stay on the normal network.

**What goes through the VPN:** `web_search`, `web_fetch`, `http_request`, and any scripts or local (stdio) connectors the agent runs (they get `HTTP_PROXY` / `HTTPS_PROXY` set).
**What doesn't:** the Sable web app, Ollama / llama.cpp, Claude and OpenAI API calls, and remote (URL) connectors.

It uses [gluetun](https://github.com/qdm12/gluetun), a VPN client container that supports most providers (Mullvad, ProtonVPN, IVPN, AirVPN, Windscribe, NordVPN, Surfshark, custom WireGuard and more). Gluetun connects to your VPN and exposes an HTTP proxy *inside* the Docker network. Sable sends agent traffic to that proxy.

```
             ┌────────────── docker network ──────────────┐
 browser ──▶ │  sable ──(models, UI)──────────────────────┼──▶ Ollama / APIs   (normal network)
             │    └──(agent web traffic)──▶ vpn:8888 ─────┼──▶ VPN tunnel ──▶ websites
             └────────────────────────────────────────────┘
```

### Setup

1. Copy the VPN settings and fill in your provider's details. For WireGuard, your provider's config file contains the private key and address.

   ```bash
   cp .env.vpn.example .env.vpn
   $EDITOR .env.vpn
   ```

   See the [gluetun wiki](https://github.com/qdm12/gluetun-wiki/tree/main/setup/providers) for your provider's exact variables.

2. Start Sable with the VPN override:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
   ```

   Sable waits until the tunnel is healthy. Its log shows `Agent web traffic: via proxy http://vpn:8888`.

3. Verify: open **Settings → Network** and press **Check exit IP**. It should show the VPN's address, not yours. The status bar also reads `egress via vpn proxy`.

### How it protects you

- **Fails closed.** If the VPN or proxy is down, agent web requests error out ("Request through the agent proxy failed… Is the VPN container up?"). Nothing falls back to your real IP. Gluetun's own firewall also blocks traffic outside the tunnel.
- **No DNS leaks for web tools.** Requests are tunnelled with `CONNECT host:port`, so names are resolved by gluetun inside the VPN, not by your server's resolver.
- **No identifying proxy headers.** `HTTPPROXY_STEALTH=on` stops gluetun from adding `Via` / `X-Forwarded-For`.
- **Not exposed.** The proxy port isn't published to the host. Only containers on the compose network can use it.

### Using an existing proxy or VPN

Any HTTP(S) proxy works. Set the variable directly, with or without Docker:

```bash
SABLE_AGENT_PROXY=http://user:pass@10.0.0.2:8888 npm start
```

The credentials are never shown in the UI or logs. SOCKS proxies aren't supported. Put [gost](https://github.com/go-gost/gost) or privoxy in front if that's all you have.

### Full tunnel (everything through the VPN)

To also send model API traffic through the VPN, run Sable inside gluetun's network namespace instead. Remove `SABLE_AGENT_PROXY`, add `network_mode: "service:vpn"` to `sable`, and move its `ports:` to the `vpn` service. Ollama on the Docker network then needs `FIREWALL_OUTBOUND_SUBNETS` (e.g. `172.16.0.0/12`) in `.env.vpn` so gluetun lets that traffic out. This mode also covers scripts that ignore proxy variables.

### Caveats

- Scripts that open raw sockets, or tools that ignore `HTTP_PROXY`, can bypass the split-tunnel proxy. Use full-tunnel mode, or set *Run script* to *Off* in Permissions, if that matters.
- Some sites block VPN IP ranges. Those requests fail instead of leaking. Switch servers with `SERVER_COUNTRIES` / `SERVER_CITIES`.

## Reaching it from your phone (HTTPS)

Installing as an app and push notifications both require **HTTPS** (except on `localhost`). The easiest options:

- **Tailscale** (private, nothing exposed publicly): `tailscale serve --bg 8787`, then open `https://<machine>.<tailnet>.ts.net`.
- **Caddy** on a domain you own: `sable.example.com { reverse_proxy localhost:8787 }`.

Then open Sable on your phone. On **iOS**, use Share → *Add to Home Screen* (push notifications on iOS only work from the Home Screen app). On **Android/desktop**, use *Install app* in the browser menu. Turn on notifications in **Settings → Notifications**.

## Configuration

Most things are set in the UI. Environment variables:

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Where the server listens |
| `SABLE_DATA_DIR` | `./data` | Database, workspace folder, generated keys |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Initial Ollama URL |
| `LLAMACPP_URL` | `http://127.0.0.1:8080/v1` | Initial llama.cpp server URL (run `llama-server --jinja` for tool calling) |
| `SABLE_MODEL` | (auto) | Initial main model |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | | Initial keys (can also be set in the UI) |
| `SEARXNG_URL` | | Use your SearXNG for web search |
| `TZ` | system | Time zone for routines |
| `SABLE_TRUST_PROXY` | private ranges | Express `trust proxy` setting, for HTTPS detection behind a proxy |
| `SABLE_PUBLIC_URL` | | Public base URL used for webhook links (also settable in the UI) |
| `SABLE_PUBLIC_PORT` | off | Port for the public front (blank page + `/hooks` only) |
| `SABLE_PUBLIC_HOST` | `0.0.0.0` | Address the public front listens on |
| `SABLE_PUBLIC_TITLE` | `Hello` | Text shown on the front's blank page |
| `SABLE_AGENT_PROXY` | | HTTP(S) proxy for the agent's outbound web traffic (see [VPN routing](#routing-agent-traffic-through-a-vpn-docker)) |
| `SABLE_VAPID_SUBJECT` | `mailto:sable-agent@example.com` | Contact for web push (VAPID) |

### Shopping (Shop by Shopify)

Sable talks to **[Shop MCP](https://shopify.dev/changelog/posts/add-shopping-and-shop-pay-checkout-to-any-agent-with-shop-mcp)** (`https://mcp.shop.com`), Shopify's official agent catalog covering Shopify stores. Ask things like *“find a mechanical keyboard under $80”*, *“add the white one to my cart”*, *“check out”*.

**What you see is real data, not the AI's words.** Product, cart, checkout and order cards are built by the server from Shop's responses: photos, exact size/color, live price, stock, seller, totals in the store's order, delivery address, shipping option, payment method and order number. The model only passes IDs; if it references a product Shop never returned, the call is refused. Price caps (“under $80”) are enforced by the server, not left to the model or the catalog filter.

| Action | Needs |
|---|---|
| Search, compare, show products, store Q&A | Nothing; no account, no approval |
| Add to / edit carts | No approval (nothing is bought) |
| Prepare checkout | Fills your linked account's email and saved address, and picks the cheapest shipping. No approval. |
| **Place order** | **Always asks**, and can't be set to automatic. Requires *Settings → Shopping → Allow the agent to place orders* (off by default), a linked Shop account, a payment method offered by the store (you choose it), and a total under your per-order limit. |

**Placing an order:** the approval shows the exact checkout fetched from the store, with a warning, and you must tick *“I've checked the item, quantity, delivery address and total”* before *Place order* is enabled. Right before paying, Sable fetches the checkout again. If items, quantities, total or payment method changed since you approved, it stops and charges nothing. A completion is never retried, so a network error can't double-charge; an uncertain result is reconciled by reading the checkout. If anything is missing (purchases off, no linked account, no saved card, over the limit, or the store needs a verification step), you get the store's own checkout link instead.

**Cards:** Sable never stores card numbers. Shopify restricts agents from submitting raw cards, and a card number the model can read could leak through a malicious page. Payment uses the card saved in your **Shop account** (Shop Pay); Sable only sees a masked label like “Visa •••• 4242”.

**Linking your Shop account** (Settings → Shopping → *Link Shop account*): Sable uses Shop's documented **device flow** with Shop's public client, which Shop provides for a shopper's own agent. You get a code and an *Open Shop* button: check the code on Shop's page and approve “Sable (personal agent)”, and Settings updates by itself. No public URL is needed. Tokens stay on the server and are only sent to `mcp.shop.com`. When a sign-in expires, Sable notifies you to link again. Prefer your own registered Shop app? Add its client ID and secret under *Use my own Shop app client (advanced)*; it must be enabled for the `personal_agent` scope and `https://mcp.shop.com`, and it uses a redirect to `<Public URL>/api/shop/oauth/callback`.

**Choosing how to pay:** the confirmation lists the payment methods the store offers for that checkout, and you pick one. Nothing is preselected; Sable sends exactly the method you chose. The account's email is never copied into a checkout, and saved addresses are used unchanged.

**Price watchers on Shop products** use the catalog directly (watcher type *shop* with the variant ID), so they read structured price and stock instead of scraping the page.

### Files and images

Scripts can run in a separate **sandbox container** that can't see Sable's database or keys: see **[docs/sandbox.md](docs/sandbox.md)** (on by default in the Docker setup).

**Each chat has its own folder** on the server, `data/workspace/chats/<chat id>/`, named by the chat's permanent ID so renaming a chat never loses its files. The agent does scratch work anywhere in it. Anything saved under **`outputs/`** appears in the chat automatically as a file card with a download button, whether the agent wrote it or a script made it. Your attachments land in the chat's `uploads/`. `data/workspace/shared/` holds files meant for every chat (files from before this layout were moved there).

Attach files with the **paperclip** in the message box, **paste** them (⌘V / Ctrl+V), or **drag and drop** them, up to 8 per message and 25 MB each. Non-image files are saved into the chat's `uploads/` folder. The agent sees the text of text files (CSV, Markdown, code, JSON…) directly, and can open or process anything else with its file and script tools. Files the agent creates or changes show up in the chat as cards with a download button. They're served as downloads only, never opened as web pages on Sable's address.

Images: attach them the same way. On phones the button opens the photo library or camera. Images are resized in the browser (longest side 1600 px; screenshots stay PNG, photos become JPEG, HEIC is converted), stored in `data/uploads`, and sent to the model in each provider's native image format. The model gets the images from your three most recent image messages; older ones are mentioned but not re-sent.

The main model must support vision. On Ollama, use something like `gemma3`, `qwen2.5vl`, `llama3.2-vision` or `mistral-small3.1`. With llama.cpp, start `llama-server` with the model's `--mmproj`. All current Claude and OpenAI models can read images.

### Local specialists (all on Ollama)

**Settings → Sub-agents → Add a local specialist** adds a purpose-built agent, each with a suggested local model, a matching toolset, a temperature and a context size:

| Specialist | Suggested model | Tools | Temp |
|---|---|---|---|
| 💻 Coder | `qwen2.5-coder:7b` | files, scripts | 0.2 |
| 🔎 Researcher | `qwen3:8b` | web search, fetch, memory | 0.3 |
| ✍️ Writer | `llama3.1:8b` | memory, files | 0.7 |
| 📊 Analyst | `qwen3:14b` | files, scripts | 0.2 |
| 🗺️ Planner | `qwen3:8b` | goals, routines, search | 0.4 |
| ⚡ Summarizer | `llama3.2:3b` | fetch, files | 0.2 |

If the model isn't installed yet, a **Download** button on the card pulls it through Ollama and shows progress. Every field is editable, including the provider, model, tools, *temperature*, *context window* (Ollama `num_ctx`) and instructions. The main agent reads each specialist's "when to use it" description to decide whom to delegate to.

### Several at once, and in the background

- **In parallel:** Sable can hand out several tasks in one go ("research these three laptops"), up to 6. They run side by side, and Sable waits for all of them.
- **In the background:** for long jobs (deep research, many pages), Sable starts the sub-agent and answers you right away. The job works like a watcher on itself. When it finishes you get a notification, a short "Helper finished · result handed back" line appears in the chat, and Sable picks up the result and continues in the same chat. You can keep chatting meanwhile.
- **You see everything:** each sub-agent has a card in the chat with its task, every tool step as it happens (including ones waiting for your OK), how long it's taken, and its full result. Cards are saved, so they're still there later. **Stop** cancels one sub-agent without stopping the rest.
- **Helper** is always available: a general sub-agent on your main model with the same tools as Sable (except delegating), so this works before you've set up any specialists.
- Running sub-agents are listed in the chat side panel's Reminders tab. A background job can't survive a server restart. It's marked stopped, and Sable tells you.
- **Findings always come back.** If a sub-agent runs out of steps, or ends by announcing more work ("Let me search…") instead of reporting, it's asked for a final report with its tools set aside. If that report is thin, the raw results of its tools are attached. Research agents (with web tools) get at least 30 steps. A stopped job shows **Continue** on its card, which picks up where it left off, and Sable can do the same itself. Sable is told never to fill gaps in research from its own memory.
- Approvals still apply. A sub-agent's risky steps ask you like Sable's do, unless they're part of a routine you approved.

> Ollama loads models on demand. With several specialists on one GPU, set `OLLAMA_MAX_LOADED_MODELS` / `OLLAMA_KEEP_ALIVE` on the Ollama side to control swapping.

### Example: local main agent + Claude for scripting

1. **Settings → Models**: set the main agent to *Ollama · qwen3:8b*, and paste your Anthropic key into the *Claude* provider.
2. **Settings → Sub-agents**: the **Coder** already uses *Claude · claude-opus-5-5* with file and script tools. Add more agents if you like, for example a second Ollama model for summaries.
3. Ask: *"Write a script that renames my photos by date."* The main agent delegates to the Coder. You see the Coder's steps nested inside the delegation, and scripts still wait for your OK.

### Connecting accounts (Notion, Google, Outlook, GitHub…)

**Settings → Connectors → Connect an account.** Integrations use the [Model Context Protocol](https://modelcontextprotocol.io). Remote servers sign in with **OAuth on the provider's own page**: Sable handles discovery, dynamic client registration, PKCE and token refresh, and keeps tokens on your server only.

| Connector | Setup |
|---|---|
| **Notion** (official) | One click: *Connect* → approve in Notion → done |
| **Linear** (official) | One click |
| **Calendar feeds (iCal)** | Paste the private iCal address from Google Calendar, Outlook or iCloud. Read-only (events + free time), works with personal accounts, no developer setup. Repeating events and time zones are handled. |
| **Google (Gmail + Calendar)** | **Sign in with Google** (Settings → Connectors → Google): read, watch and send Gmail and read/add Calendar events, with personal Gmail and no app password. Needs your own Google Cloud OAuth client once; see [docs/google-connectors.md](docs/google-connectors.md). |
| **Outlook & Microsoft 365** (open-source [Softeria server](https://github.com/Softeria/ms-365-mcp-server)) | Runs on your server via `npx`, with no app registration. Ask Sable to “log in to Microsoft 365” and enter the code it gives you at microsoft.com/devicelogin. Microsoft's own Outlook MCP servers currently require a Microsoft 365 Copilot license. |
| **GitHub** (official) | Paste a fine-grained personal access token |
| **Anything else** | *Custom*: any MCP server URL (OAuth sign-in or headers), or a local command |

The OAuth redirect URI is the address you open Sable at plus `/api/mcp/oauth/callback` (shown in each connector's details). It never needs to be public: providers only send your browser back to it. Connector actions ask for approval by default. **Allow read-only tools without asking** on a connector auto-approves the tools its server marks as read-only, so reading your calendar doesn't prompt every time, while anything that sends or changes data still asks.

## Architecture

```
server/  Node + Express + node:sqlite
  src/agent/runner.ts     agent loop: streaming, tool execution, sub-agents, background runs
  src/agent/sentinel.ts   policy decisions + approvals
  src/agent/tools/        built-in tools and MCP connectors
  src/llm/                Ollama, OpenAI-compatible (OpenAI, llama.cpp, LM Studio…), Anthropic SDK
  src/scheduler.ts        routines
  src/push.ts             web push (VAPID keys generated on first run)
web/     React 19 + Vite + Tailwind 4 + Motion, PWA with a custom service worker
```

The browser receives live updates over Server-Sent Events (`/api/events`). Runs are owned by the server, so any device can watch or approve them.

## Security notes

### Guardrails (ideas borrowed from Oni)

- **Untrusted content can't trigger actions on its own.** Once a task has read something untrusted (a web page, an email, an API reply, a webhook or watcher payload), anything that reaches outside Sable needs your OK, even tools you set to run automatically: sending, posting to a webhook, running a script, calling an API. Saving files in the chat folder and managing reminders still run. A sub-agent inherits this from the task that started it, and its report counts as untrusted when it comes back. Routines and watchers you approved keep their pre-approval.
- **Freeze.** The snowflake in the status bar, or `/freeze` in any chat, makes Sable observe-only at once. It can still search and read, but nothing that changes, sends or buys runs, and waiting approvals are denied. `/thaw` (or **Unfreeze** on the banner) turns it back on.
- **Instant commands** that don't involve the AI, so they work even if the model is down: `/freeze`, `/thaw`, `/status` (what's running, approvals waiting, whether the activity log is intact), `/help`.
- **Secrets are redacted on the way out.** Known secret values (provider keys, mailbox passwords, channel tokens, connection keys) and secret-looking strings (API keys, tokens, private keys, `password=…`) are replaced with `[REDACTED]` in tool results the model sees, notifications, webhook and channel posts, emails Sable sends, and the activity log.
- **Tamper-evident activity log.** Each entry is sealed to the one before it with an HMAC (key in `data/audit.key`, or `SABLE_AUDIT_KEY`). The Activity page shows **Log intact**, or where it was changed.

- Sable is single-user per instance. Protect it with a strong password and **two-factor authentication** (Settings → Security), and prefer a private network (Tailscale/VPN) over exposing it to the internet. To host for others, run one instance each ([docs/hosting-securely.md](docs/hosting-securely.md)).
- Built in: TOTP 2FA with recovery codes, login rate limits, hashed session tokens with "sign out everywhere", per-instance cookie names (`__Host-` on HTTPS), cross-site request blocking (including sibling subdomains), a strict Content Security Policy, and agent-built spaces served sandboxed with no network access.
- `SABLE_PUBLIC_PORT` starts an optional **public front** that serves only a blank page (`SABLE_PUBLIC_TITLE`) and `/hooks`. Expose that port instead of the app.
- `run_script` executes code **on your server** as the Sable user, confined to the workspace directory, with a minimal environment and a timeout. It is not a container sandbox. Run Sable in Docker, or as an unprivileged user, if that matters to you, or set *Run script* to *Off*.
- Connectors run with whatever access you give them.
