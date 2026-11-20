# Sable roadmap: from web app to personal life agent

*Written 2026-11-20. This is the plan, not a promise. The detailed research behind it is in [`docs/research/`](research):*

- *[Android app](research/android-app.md)*
- *[Reaching you](research/reaching-you.md)*
- *[Voice and the dedicated server](research/voice-and-server.md)*
- *[Spaces as full apps](research/spaces-v3.md)*

## The idea

Sable manages **your life**. Oni manages **the server**. Sable is the one assistant you talk to everywhere: the app, Telegram, email, and eventually your voice. It does the small, frequent things on cheap local models, and saves Claude for the big ones. Everything uses official connections wherever they exist, the way Google is connected now.

## The core change: one main brain, many small chats

Today every chat is equal, and automations each get their own chat. The plan:

**Main chat ("Sable")**
- One permanent conversation, pinned at the top of the app.
- It's where **every channel lands**: messages from the app's home screen, Telegram, the agent mailbox, and calls.
- Replies go back the way you reached it. Proactive messages go to the channel you're most likely on.

**It runs forever:**
- Older turns get rolled into summaries automatically (compaction), so the chat never "fills up".
- It keeps its own **journal**: what happened each day, decisions made, and open loops ("I said I'd check X on Friday").

**Its own memory, on top of the shared memories:**
- the journal
- commitments
- your current context (where you are, what you're doing, what's coming up)

**It's the default inbox for automations.** Routines, watchers and background sub-agents report a short line here, with a link to their detail chat. One stream instead of many.

**Mini chats** are for topics ("help with this essay", "plan the trip"). They:
- read the shared memory (me, people, how-tos)
- don't clutter the main chat
- send a short **digest up to the main chat** when they wrap up ("Trip planned: flights booked for Dec 3; still need a hotel"), so the main brain knows what happened without carrying the whole conversation

**Mini chats can't edit the main chat's journal directly.** They propose facts, and the main brain decides. This keeps the main memory clean and limits the damage from anything injected into a side chat.

## Phases

Each phase is useful on its own. The order follows value and what today's hardware can do.

### Phase 1: main brain and channels (current server, no GPU needed)

| Goal | Steps |
|---|---|
| Main chat | Pinned "Sable" conversation. Rolling summaries. Journal and open-loops memory. Digests from mini chats. Automations report into it |
| Channel router | One place that decides how to reach you: urgency levels (info, normal, high, critical), quiet hours, dedupe, one acknowledgement clears everywhere, and a daily cap |
| Telegram | Bot with long polling (no public URL), locked to your user ID. Two-way chat into the main brain. Approve/Deny buttons. Photos, files and location in. Streamed replies. Voice notes stored now and transcribed once the GPU server exists |
| Agent mailbox | A dedicated address you can email from work or school. DMARC check plus allowlist. Threaded replies. Approvals go to your phone. Ask it "send me the slides from my Drive" and get a reply in the same thread |
| Microsoft sign-in | Official Microsoft Graph OAuth, like the Google one. Outlook mail and calendar, and OneDrive/Office files. Many work and school accounts are Microsoft 365. Their IT may block third-party apps; we find out when you try |

### Phase 2: Android app

| Goal | Steps |
|---|---|
| App shell | Capacitor app wrapping today's UI. Signed with your key. Package registered under a free limited distribution account. Installed with adb. Sable serves its own updates |
| Notifications | FCM data pushes (content stays on your server). Native Approve/Deny and inline reply on the notification |
| Camera and sharing | Take or pick photos and video for Sable. "Share to Sable" from any app |
| Location | Geofence reminders ("when I get to the store"), share location on request, a context signal ("at work" means quieter). Visible toggle and history, coarse by default |
| Extras | Quick Settings tile, home-screen widget, optionally the default-assistant role |

### Phase 3: Spaces v3 (real apps)

| Goal | Steps |
|---|---|
| Live camera in a Space | "Local device" connections (plain http on your LAN, exact IP, password in the vault). Sable proxies MJPEG and snapshots, so the stream shows instead of a broken image |
| Media relay | go2rtc sidecar: RTSP/ONVIF cameras as smooth live video, plus snapshots for the vision model |
| Space backends | Each Space becomes a folder with UI, a Deno backend, a SQLite database, schedules and a manifest. One locked-down container per Space. Network allowlists. Approval cards when the manifest changes. Logs, test, deploy and rollback tools so Sable can debug its own apps |
| Devices | Home Assistant through its MCP server, if you run it. MQTT watchers. Frigate events, if you add it |

### Phase 4: the dedicated server (voice and local brains)

| Goal | Steps |
|---|---|
| Hardware | The recommended mid build is a used RTX 3090 (24 GB), Ryzen 7/9, 64 GB RAM, about $2.8–3.5k at today's prices. Or reuse what you have. Prices are moving; check before buying |
| Local models | Main local model on the GPU (Gemma 4 26B-A4B or Qwen3.6-27B), a small router model, embeddings plus a reranker. Sable routes small work locally and big work to Claude, with a usage view |
| Voice in the app | Witty or Pipecat as the voice loop with Sable as the brain. Kokoro voice, streaming STT. About 0.6–1 s replies |
| Voice notes | Telegram voice notes transcribed locally. Sable can answer with voice notes |
| Calls | First the app "calls" with a high-priority notification that opens the voice screen. Then a real ringing call screen (core-telecom). Then real phone calls through Twilio or Telnyx for critical alerts only, with a call budget |

### Phase 5: Oni bridge

Oni keeps the server healthy; Sable keeps your life running. They talk through a small, explicit contract:

- **Oni → Sable:** incidents worth telling you about ("disk at 95%", "backup failed"), routed through Sable's channel router so you get one voice, not two.
- **Sable → Oni:** read-only questions ("is everything healthy?", "is the GPU free?"), and requests that Oni approves and does itself ("restart the voice container").
- Sable never manages the server directly. Oni stays in charge of hardware.

How depends on Oni: an MCP server, a webhook pair, or a self-built connection. To be decided once Sable can see the Oni repo.

## Ideas you didn't ask for (but might want)

- **Morning and evening check-ins in the main chat:**
  - Morning: today's calendar, weather, what's arriving, open loops.
  - Evening: "you said you'd email Sam, did you?".
  - Short, and skipped when there's nothing to say.
- **Open loops:** Sable tracks what it promised and what you said you'd do, and nudges once.
- **Context awareness:** location, calendar and time decide how loud Sable is. Quiet in class or at work, normal at home.
- **Share sheet to memory and tasks:** share a screenshot of a flyer and Sable adds the event. Share an article and it's saved and summarized for later.
- **Documents vault:** receipts, warranties and IDs, read and searchable. "When does my laptop warranty end?"
- **Cost and usage router:** a page showing what ran locally vs on Claude, and what it cost. A monthly Claude budget. Sable asks before going over it.
- **Encrypted backups of Sable's data:** your life data deserves backups, and Oni could watch that they succeed.
- **Per-channel trust:**
  - Telegram from your ID and the app are trusted.
  - Email is "verified but cautious".
  - Anything else is untrusted.
  - Riskier actions from cautious channels need a tap on your phone.
- **Family or guest access, later:** a shared grocery list Space without giving anyone your Sable.

## Housekeeping

- **Making the GitHub repo private:** nothing in Sable depends on it being public. There are no Actions, no published images, and Docker builds locally. Obtainium (or Sable itself) can serve app updates from a private repo with a token. Keep secrets out of the repo anyway (`deploy/.env` stays untracked).
- **Usage strategy:** Claude for building Sable and for hard tasks inside Sable. Local models for routing, summaries, reminders and the long tail.

## Open questions

These are tracked in the chat, and also here so they don't get lost:

1. Which country and phone carrier? This decides Android verification enforcement, US SMS rules and calling prices.
2. Is Sable reachable only over Tailscale, or also on your public domain? This decides push, Telegram webhooks vs polling, and phone calls.
3. OK with Google FCM for app notifications (metadata goes through Google, content doesn't)?
4. Telegram (official, not end-to-end encrypted) or Signal (end-to-end encrypted, unofficial)?
5. Do you have a domain for the agent mailbox? Are your work and school accounts Google or Microsoft?
6. Home Assistant? Which cameras (brand, RTSP or MJPEG)?
7. Server budget, where it lives (noise), existing parts to reuse, languages besides English, and a custom voice for Sable?
8. Should automations report into the main chat by default?
9. Phone calls: what counts as critical, quiet hours, and a monthly budget?
10. Oni: how does it expose itself (API, MCP, webhooks)? Link the repo when ready.
11. Spaces: may a Space ever have both LAN and internet access? Should Spaces control devices (plugs, locks), or only read and notify at first?
