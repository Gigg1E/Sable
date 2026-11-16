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
| **Chat with goals** | Describe an outcome. The agent makes a plan (a *goal* with steps), works through it with tools, and reports back. Responses stream live, with collapsible reasoning and expandable tool steps. |
| **Background work** | Runs live on the server, not in your browser tab. Close the app and the work continues. **Routines** run on a schedule (once, every N minutes, daily, weekly). |
| **Approvals (the Sentinel)** | Every tool call goes through a policy check: *Auto*, *Ask* or *Off*, per tool. Web access is approved per domain ("Always allow example.com"). Approvals show up in the chat, in the Inbox and as push notifications. |
| **Activity log** | A complete, searchable record of every action each agent took, approved, or was blocked from taking. |
| **Sub-agents** | Configurable specialists, each with its own provider, model, effort and toolset. The defaults are a **Coder** (Claude, with files and scripts) and a **Researcher** (Ollama, with web search and fetch). |
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

Data (database, workspace, keys) lives in the `sable-data` volume.

### Development

```bash
npm run dev          # API on :8787 (auto-reload) + Vite on :5173 with HTTP proxying
```

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
| `SABLE_AGENT_PROXY` | | HTTP(S) proxy for the agent's outbound web traffic (see [VPN routing](#routing-agent-traffic-through-a-vpn-docker)) |
| `SABLE_VAPID_SUBJECT` | `mailto:sable-agent@example.com` | Contact for web push (VAPID) |

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

> Ollama loads models on demand. With several specialists on one GPU, set `OLLAMA_MAX_LOADED_MODELS` / `OLLAMA_KEEP_ALIVE` on the Ollama side to control swapping.

### Example: local main agent + Claude for scripting

1. **Settings → Models**: set the main agent to *Ollama · qwen3:8b*, and paste your Anthropic key into the *Claude* provider.
2. **Settings → Sub-agents**: the **Coder** already uses *Claude · claude-opus-5-5* with file and script tools. Add more agents if you like, for example a second Ollama model for summaries.
3. Ask: *"Write a script that renames my photos by date."* The main agent delegates to the Coder. You see the Coder's steps nested inside the delegation, and scripts still wait for your OK.

### Example: a connector

**Settings → Connectors → Add connector**, local command:

```
command:  npx
args:     -y
          @modelcontextprotocol/server-filesystem
          /home/me/Notes
```

Save, then its tools appear under **Permissions**, set to *Ask* by default.

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

- Sable is single-user. Protect it with a strong password, and prefer a private network (Tailscale/VPN) over exposing it to the internet.
- `run_script` executes code **on your server** as the Sable user, confined to the workspace directory, with a minimal environment and a timeout. It is not a container sandbox. Run Sable in Docker, or as an unprivileged user, if that matters to you, or set *Run script* to *Off*.
- Connectors run with whatever access you give them.
