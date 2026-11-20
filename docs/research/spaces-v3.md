# Research: Spaces as full apps, with live cameras and devices

*Researched 2026-11-20, with Sable's current code read for context. Items marked **unverified** need testing.*

## Why a camera shows as a broken image today

**How Spaces work now:**
- A Space is one HTML file served in a locked-down frame.
- Its security policy blocks all network access (`connect-src 'none'`).
- It only allows `https:` images and `data:`/`blob:` media.
- Data moves only through the `sable.get/set/on/ask/act` bridge.

**Why a camera can't work:**
- A LAN camera at `http://192.168.x.x` is blocked because it isn't https.
- It would also be mixed content behind Tailscale HTTPS.
- It usually needs a password.
- RTSP doesn't play in browsers at all.

**The stream has to come through Sable,** from the same place the page comes from, with the password added on the server.

**What else is missing:**
- Self-built connections only allow https today, so LAN devices need a new "local device" connection type.
- The script sandbox is one shared box for short scripts. It has open internet and can see every chat folder, so it isn't built to run a Space's backend 24/7.

## How others do it

| Product | Pattern | Lesson |
|---|---|---|
| Claude artifacts | A single-file UI in a sandbox, with model and connector calls brokered | That's Spaces v2. A broker is right; having no backend is the limit |
| **Val Town** | Small TypeScript handlers with triggers (HTTP, cron, email), a **private SQLite per app**, and versioned code | **The programming model to copy** |
| Replit Agent | A full VM with a database | Too heavy, but copy its loop: the agent reads logs, fixes, redeploys |
| Bolt / Lovable | UI plus Supabase (database, functions, secrets) | The shape: static UI, small functions, a database, secrets |
| Windmill | Self-hosted scripts with schedules and secrets | Reference for workers and secrets |
| Node-RED / n8n | Flow engines | Don't rebuild these. Sable can call them over webhooks or MQTT |
| **Home Assistant apps** | One container per app, shown through an authenticated proxy at a sub-path | **The hosting model to copy** |
| Workers / isolates | Fast, but "not a hardened sandbox" (escapes reported in 2026) | Not a safe boundary for agent-written code |
| Open WebUI functions | Python plugins run inside the server | **The anti-pattern:** several RCE CVEs in 2026. Never run agent code in Sable's own process |

## Proposed design: Spaces v3

Copy **Val Town's programming model** and run it on **Home Assistant's hosting model**.

**Files.** Each Space is a folder:
- `ui/index.html`
- `server/main.ts`
- `space.json` (the manifest)
- `data/` (`space.db` SQLite and files)

It's also a git repo, so every edit is a version you can roll back.

**Isolation:**
- One container per Space, started by a small `space-host` service. Only that service has Docker access, through a socket proxy.
- Container limits:
  - read-only, with no capabilities
  - about 256 MB of memory and half a CPU, plus a pids limit
  - optionally gVisor
- **Deno** runs inside with explicit permissions: net only to approved hosts, files only in `/data`, no subprocesses.
- A Python variant is available for vision and OpenCV work.
- Idle Spaces sleep. Spaces holding a stream stay up.

**Network:**
- Deny everything by default. Each Space has an allowlist of exact `host:port` entries, for example `192.168.1.40:554`. It's enforced twice: by Deno and by the network.
- Never allowed unless you explicitly say so:
  - the router
  - Sable itself
  - Docker
  - other Spaces
  - the rest of the LAN
- Internet access is opt-in per host.

**Web:**
- `/spaces/<id>/api/*` and `/spaces/<id>/live` (SSE or WebSocket) are proxied by Sable.
- Sable checks it's you, gives the frame a short-lived per-Space token, and strips your login cookies before forwarding.
- Serving Spaces from their **own origin** (a separate port or `spaces.` subdomain) keeps Sable's cookies fully isolated. Recommended.
- The SDK gains `sable.api()`, `sable.live()` and `sable.media()`.

**Storage, schedules, secrets:**
- SQLite per Space. The existing `sable.get/set` keeps working.
- Scheduled jobs are declared in the manifest and fired by Sable's scheduler.
- Secrets come from the vault: the manifest names them and you approve each one. They're injected only into that container, and the model never sees them.
- Camera passwords are better still added by the media relay, so Space code never sees them either.

**The agent's tools for its own Spaces:**
- `space_logs` and `space_status`
- `space_restart`
- `space_test(request)`: send a test request and see the response and timing
- `space_snapshot`: a screenshot of the UI
- `space_deploy` (health-check, then swap)
- `space_rollback`

**Approvals, the same rule as connections:**
- Code changes deploy freely.
- Any change to the **manifest** (hosts, secrets, schedules, devices, limits) shows you a diff card to approve.
- A Space can never change its own manifest.

## Live cameras

| Format | In the browser | Latency | Notes |
|---|---|---|---|
| MJPEG | Plain `<img>` | Low | Heavy bandwidth, no audio. **Proxying it fixes the broken image right away** |
| RTSP | Doesn't play | — | Must be converted |
| HLS / LL-HLS | Everywhere | ~0.8 s (LL), ~20 s (classic) | |
| WebRTC | Yes | ~40 ms on LAN | Needs UDP, which is awkward through Tailscale or a proxy |
| **MSE over WebSocket** | Yes | Near WebRTC | **Best fit for a proxied Space** |

- **go2rtc** is the recommended media relay sidecar.
  - It takes RTSP, ONVIF, Tapo and other sources.
  - It serves WebRTC, MSE, HLS and MJPEG, choosing automatically.
  - It serves **JPEG snapshots** (`/api/frame.jpeg`), which suit vision models.
  - Only Sable can reach it. Camera passwords live in its config, generated from the vault.
- **MediaMTX** is a fine alternative.
- **Frigate** (an NVR with object detection) is the thing to integrate, not rebuild. Sable would subscribe to its MQTT events and pull clips and snapshots. Custom Space scripts are for the long tail, like "count birds" or "did the 3D print fail?".
- **ONVIF discovery** scans the LAN, so it should be a tool you start, with an approval card.
- **Vision:** cheap motion detection first. Only when something changed, call the local vision model through Sable, with budgets.

## Devices: integrate, don't rebuild

- **Home Assistant**, if you run it, should be the device layer.
  - Use its REST/WebSocket API, its built-in **MCP server** or `ha-mcp`. Sable already supports MCP connectors, so this is a quick win.
  - Expose a filtered set of entities. Locks, alarms and garage doors stay approval-gated.
- **MQTT** is the one protocol worth adding natively: a new watcher source, plus per-Space topic allowlists. Publishing asks first.
- **Local HTTP devices** (Shelly, Tasmota, OctoPrint, printers, NAS): a "local device" connection type. Plain http on an exact IP and port, Basic or Digest auth, reads are free and writes ask.
- **Node-RED / n8n:** don't embed them. Each side can call the other's webhooks.
- **USB/serial (later):** pass one device into one approved Space container.

## Risks and mitigations

1. **Prompt injection into code.** A web page, email, MQTT message or text in a camera image could talk the agent into writing a backdoor or widening access.
   - Mark everything as untrusted.
   - Approval cards show the exact change in hosts and ports, not the agent's explanation of it.
2. **The LAN.** Agent code could scan the network or reconfigure a camera.
   - Exact IP and port only, never a whole subnet.
   - Anything that changes a device asks you first.
3. **Container escape.** gVisor or rootless containers, and no Docker socket in the Spaces.
4. **Footage leaving the house.** No internet by default. A warning when a Space has both camera and internet access.
5. **Runaway code.** Memory and CPU limits, a disk quota, crash-loop backoff, and a pause switch.
6. **Model use from a Space.** Goes through Sable with rate and cost caps. Spaces never get API keys.

## Phases

1. **Media proxy and local devices** (small, high value):
   - A "local device" connection type.
   - `/spaces/<id>/media/<name>` to proxy MJPEG or snapshots with the password added.
   - A CSP update or a separate Spaces origin.

   Result: **a working live camera in a Space.** Plus a Home Assistant MCP guide.
2. **Media relay:**
   - go2rtc sidecar.
   - `sable.media()` with an MSE/WebRTC player.
   - A snapshot tool for the agent.

   RTSP cameras work with about 0.5 s delay.
3. **Space backends:**
   - space-host with one container per Space.
   - Manifest with approval diff cards.
   - SQLite, `/api` and `/live`.
   - Logs, test, restart and rollback tools.

   Today's Spaces keep working as UI-only Spaces.
4. **Devices and events:** MQTT, Frigate events into watchers, ONVIF discovery, model access from Spaces with budgets.
5. **Hardening:**
   - gVisor option.
   - A log of blocked network attempts.
   - Resource usage per Space.
   - Export and import, templates.
   - USB passthrough.

## Spaces worth having (life, not server health)

1. **Front door / packages:** live stream plus a "person or package at the door" timeline. "A courier left a box at 14:12."
2. **Pet cam and feeder log:** did the cat eat? A smart feeder, with approval.
3. **3D print, oven or kettle watch:** a snapshot every 30 s goes to a vision check, plus power draw.
4. **Home energy and bills:** smart plug and meter history, cost per appliance, "the heater's still on" alerts.
5. **Plants and grow box:** sensors over MQTT, a timelapse, watering reminders.
6. **Air quality and sleep room:** CO2, PM2.5 and temperature, "open a window" nudges.
7. **Bird feeder species log:** motion triggers a vision check, building a tally and a photo gallery.
8. **Mail and parcels hub:** shipping emails plus the porch camera confirming delivery.
9. **Personal finance:** bank CSV import, nightly categorizing, budget alerts.
10. **Habits and medication:** an NFC tag or button press logs a dose, with reminders if one's missed.

## Sources

- [Val Town](https://www.val.town/x/valdottown/blog/code/posts/2026-03-05-newsletter-26.md) · [Lovable Cloud](https://docs.lovable.dev/features/cloud) · [HA apps rename](https://www.home-assistant.io/blog/2026/02/04/release-20262/)
- [workerd](https://github.com/cloudflare/workerd) · [Check Point on agent glue](https://research.checkpoint.com/2026/when-agentic-glue-melts/) · [Deno permissions](https://docs.deno.com/runtime/fundamentals/security) · [gVisor networking](https://gvisor.dev/docs/user_guide/networking)
- [Open WebUI security dispositions](https://docs.openwebui.com/security/vendor-dispositions.md)
- [go2rtc](https://github.com/AlexxIT/go2rtc) · [MediaMTX](https://github.com/bluenviron/mediamtx) · [Frigate docs](https://docs.frigate.video)
- [HA WebSocket API](https://developers.home-assistant.io/docs/api/websocket) · [HA REST API](https://developers.home-assistant.io/docs/api/rest/) · [HA MCP server](https://www.home-assistant.io/integrations/mcp_server/) · [ha-mcp](https://github.com/homeassistant-ai/ha-mcp)
