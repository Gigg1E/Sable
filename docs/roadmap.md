# Sable roadmap: phases and goals

*Updated 2026-11-20. Each goal has a **done when** so we know it's finished. The rule: **backend first, app last.** The phone app waits until the backend is solid, so we never update the website and the app in parallel.*

**Design docs:**
- [Core concepts](design/core-concepts.md): main brain, chats that wake themselves, reminders vs follow-ups, Spaces on Sable's engines, notification visuals, wake-ups, when to reach you
- [Look and feel](design/look-and-feel.md): polished, not AI-generated; the intro animation

**Research:**
- [Library](research/library.md)
- [Email](research/email-on-your-domain.md)
- [Private channels and calls](research/private-channels-calls-ring.md)
- [Android](research/android-app.md)
- [Spaces v3](research/spaces-v3.md)
- [Voice and server](research/voice-and-server.md)
- [Oni notes](research/oni-notes.md)
- [First channel survey](research/reaching-you.md)

## Decisions so far

| Topic | Decision |
|---|---|
| Sable vs Oni | Separate. Oni maintains servers; Sable runs your life. **They don't talk to each other.** Sable borrows a few of Oni's ideas ([notes](research/oni-notes.md)) |
| Order | Fixes and polish → backend foundations → email → Spaces → phone app → AI server |
| Channels | The **Sable app over Tailscale** is the private channel. Pushes are empty wake-up pings. No Telegram as the main channel |
| Calls | The app ↔ Sable both ways (Sable calls you, you call Sable). **No paid Google Play, no Android Auto requirement**; the car isn't a priority. Voice comes with the AI server ([Witty](https://github.com/Gigg1E/witty)) |
| App install | Sideload (adb) plus the **free** limited-distribution registration. No $25 Play account |
| Library | **Open** half (anything) and **private** half (secrets, personal details, people, messages, memories, actions taken). Private content never goes to cloud models unredacted |
| Email content | Not stored in the Library; read live. What Sable *sent* is kept as private history |
| People | Sable learns you, and the people and pets around you (who they are, how to reach them) |
| Automations | Keep their own chats. The model may deliver important things into the conversation that asked (`follow_up`) |
| Cameras | Your own local cameras, not Ring |
| Main chat | The app's home screen |
| Look | Animations with meaning; a polished product, not AI-generated ([principles](design/look-and-feel.md)) |
| Networks | Home internet Xfinity, phone AT&T, domain DNS on Cloudflare, remote access via Tailscale |

## Phase 0: fix, harden, polish

*Current server. No new hardware or accounts.*

**0.1 Sub-agents always report what they found** ([§5](design/core-concepts.md#5-sub-agents-always-report-what-they-found-bug-fix-first))
- **Tasks:**
  - Forced final report with tools off when a sub-agent hits its limit or ends on a plan.
  - Fallback digest of what its tools returned.
  - Higher limit for research agents.
  - `continue` for stopped jobs.
  - Prompt rule: "never fill research gaps from memory".
  - The card shows stopped/continued state.
- **Done when:** a researcher stopped at its limit still hands back its findings with sources, and the main agent can continue it.

**0.2 Safety upgrades borrowed from Oni** ([notes](research/oni-notes.md))
- **Tasks:**
  - **Taint per run:** after untrusted content, actions beyond reading ask you.
  - **Risk per call** for commands and file writes.
  - **Freeze:** one tap or one word makes Sable observe-only and denies pending approvals.
  - **Reflex commands** that skip the model (`/status`, `/freeze`, `/thaw`).
  - **Redactor** on everything going to channels and cloud models.
  - **Tamper-evident activity log.**
- **Done when:** a planted instruction in a fetched page can't make Sable send, buy or delete without a tap; freeze works from the app and a notification; secrets never appear in outgoing text.

**0.3 Look and feel pass** ([principles](design/look-and-feel.md))
- **Tasks:**
  - The **intro animation** (the mark draws itself, then becomes the sidebar).
  - Motion tokens and rules.
  - A pass over chat, sidebar, cards, Inbox and Settings for consistency, empty states and skeletons.
  - Visual signatures for the event kinds that already exist (reminder, watcher, approval, sub-agent, file).
- **Done when:** screenshots and recordings in dark and light, desktop and phone width, pass the "would this look out of place in Linear?" check.

## Phase 1: the foundation (Library, people, chats that wake, main brain)

**1.1 Library, P0** ([design](research/library.md))
- **Tasks:**
  - `library.sqlite` with hybrid search (keywords + meaning).
  - **Open/private classification on the way in**, with a local secret and personal-details check.
  - Memories moved in.
  - Notes, web pages, chat outputs and uploads go in.
  - Sources and trust labels.
  - `library_*` tools.
  - A Library page with filters, plus real "forget".
- **Done when:** "how did I set up X last month?" finds the right chat output from another chat; private items never reach a cloud model unredacted; forgetting an item removes every trace.

**1.2 People and pets**
- **Tasks:**
  - Private people pages: relationship, aliases, ways to reach them, preferences ("prefers Discord").
  - Learned from conversation, editable by you.
- **Done when:** "message my best friend that I'm running late" asks only "Discord or email?" the first time, and nothing the second time.

**1.3 Chats that wake themselves** ([§2](design/core-concepts.md#2-chats-that-wake-themselves))
- **Tasks:**
  - "Here" vs "background" delivery for watchers, webhooks, reminders, email and jobs.
  - `follow_up` (Sable reminds you itself, with context).
  - Follow-up chips in the chat and side panel.
- **Done when:** a package watcher set up in a chat wakes *that* chat with the history ("the one we tracked since the 12th").

**1.4 Main brain chat** ([§1](design/core-concepts.md#1-the-main-brain-and-mini-chats))
- **Tasks:**
  - The pinned main chat as home.
  - Rolling summaries, so it never fills up.
  - Journal and open loops.
  - Digests from mini chats.
- **Done when:** after weeks of use the main chat still loads fast, knows what happened in topic chats, and reminds you of open loops once.

**1.5 Wake-ups** ([§6a](design/core-concepts.md#6a-wake-ups-sable-checks-in-on-its-own))
- **Tasks:**
  - **Morning rundown:** today's plan, plus the "available windows" for reaching you.
  - **Night check:** looks at tomorrow's calendar and flags problems. Alarm-setting waits for the app (Phase 4).
- **Done when:** a night with an early class and nothing scheduled produces a heads-up in the morning rundown, or the evening before.

## Phase 2: email on your domain

**2.1 An always-on agent mailbox** ([guide](research/email-on-your-domain.md))
- **Tasks:**
  - Decide between moving your existing allowlisted mail service to a spare always-on machine, or an off-site mailbox.
  - DNS on Cloudflare: SPF, DKIM, DMARC, MTA-STS.
  - Sable reads it with the email connector.
- **Done when:** you email Sable from work or school and get a threaded reply, even after Sable's server has restarted.

**2.2 Agent mailbox rules**
- **Tasks:**
  - Allowlist and DMARC/DKIM check.
  - Email text treated as data.
  - Approvals on your phone or in the app.
  - Send limits, and no replies to strangers.
  - "Send me the file from my Drive" works.
- **Done when:** spoofed or unknown mail is quarantined and never acted on.

## Phase 3: Spaces v3

**3.1 Spaces as real apps** ([research](research/spaces-v3.md), [§3](design/core-concepts.md#3-spaces-built-on-sables-engines-not-rebuilding-them))
- **Tasks:**
  - **Bindings to Sable's engines:** webhooks, watchers, connections, Library collections.
  - **Wake their chat.**
  - **Theming tokens injected.**
  - Local-network access with an approved host list; the internet blocked unless approved.
  - Then backends: a container per Space, storage, schedules, logs, test and rollback.
- **Done when:** Sable can build, for example, a "deliveries" Space fed live by webhooks and an email watcher, with its own small database, that looks right in dark and light.

**3.2 Live media and your cameras**
- **Tasks:**
  - "Local device" connections.
  - Media proxy and the go2rtc relay.
  - Snapshots for vision.
  - Presence and motion events as wake-ups.
- **Done when:** a local camera's live view plays smoothly inside a Space, and a motion event can wake a chat.

## Phase 4: the Android app (after your phone arrives *and* Phases 0–2 are stable)

**4.1 App shell:** Capacitor app wrapping the web UI. Sideloaded with adb and registered free. Tailscale always-on. Self-updates from Sable.
- **Done when:** the app opens straight into the main chat, over Tailscale.

**4.2 Notifications:**
- **Tasks:**
  - Empty wake-up pings, content fetched over Tailscale.
  - Approve/Deny and reply in the notification.
  - Visual signatures (map, progress, snapshot).
  - Live Updates, mirrored on the Glyph Bar.
- **Done when:** an approval can be handled from the lock screen, and Google never sees content.

**4.3 Phone abilities:**
- **Tasks:**
  - Location and geofences.
  - Share-to-Sable.
  - Camera.
  - Availability signals (driving, DND, calendar).
  - **Setting alarms** for the night check.
- **Done when:** "remind me at the store" fires at the store, and the night check can set a missing alarm.

## Phase 5: the AI server (when the hardware is built)

**5.1 Local models:** a big local model by default, a small router, Ollama cloud models only for open content.
- **Done when:** private chats never touch a cloud model, and small tasks stay local.

**5.2 Library with media:** captions, transcripts, image search, reranker. Private content processed locally.
- **Done when:** "find the photo of the receipt from last week" works.

**5.3 Voice and calls:**
- **Tasks:**
  - [Witty](https://github.com/Gigg1E/witty) as the voice loop with Sable as the brain.
  - Talk in the app.
  - **Sable calls you and you call Sable** (the app rings through Android's calling framework).
  - Presence greetings spoken.
- **Done when:** a doorbell or motion event while you're driving becomes a short call, and you can call Sable to ask about your day.

## Back burner

- Android Auto call screen (needs a paid Play account).
- Twilio/Telnyx calls to your phone number.
- Telegram, Signal and Matrix as extra channels.
- Ring (not your account).
- Fine-tuning a small local model on Sable's own episodes, Oni-style.

## Questions to settle when we get there

- **Phase 2:** how does your current desktop mail service receive mail (Cloudflare Email Routing to a Worker, forwarding, something else)?
- **Phase 4:** night check: set the alarm **automatically**, or **ask first**?
- **Phase 1:** Library: should chat outputs and uploads go in automatically, or only when promoted?
- **Phase 3:** cameras: which models are you considering (to confirm RTSP/ONVIF)?
