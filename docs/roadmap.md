# Sable roadmap: from web app to personal life agent

*Updated 2026-11-20. This is the plan, not a promise. No code is written from it until we agree on where to start.*

- **Design ideas:** [`docs/design/core-concepts.md`](design/core-concepts.md). The main brain, chats that wake themselves, "I'll remind you", Spaces on Sable's engines, notification visuals, when to call.
- **Research** (with sources):
  - [Android app](research/android-app.md)
  - [Private channels, calls, Ring](research/private-channels-calls-ring.md)
  - [Reaching you (first pass)](research/reaching-you.md)
  - [Email on your domain](research/email-on-your-domain.md)
  - [Library (shared database)](research/library.md)
  - [Voice and the server](research/voice-and-server.md)
  - [Spaces as full apps](research/spaces-v3.md)

## The idea

Sable manages **your life**; Oni manages **the server**. Sable is the one assistant you talk to everywhere: its own app, email and eventually your voice. It does small, frequent things on local models and saves big cloud models for when they're worth it. It uses official connections wherever they exist, and keeps private things private.

## What we know

| Topic | Answer | What it means |
|---|---|---|
| Where you are | Florida, USA. AT&T, moving your SIM to an Android (Nothing Phone 4a class) | US rules for SMS/10DLC. Android Auto in the car. Google's sideloading rules hit the US in 2027 |
| Remote access | Tailscale only, with Tailscale on the phone | The app talks to Sable privately. Anything that must reach Sable from outside (Ring webhooks, Twilio) needs a tiny public relay |
| Push | Unsure; new to Android | **Recommended:** Google's push (FCM) with **empty wake-up pings**. Google sees that a ping happened, never what it says. The app fetches the content over Tailscale. ([explained](research/private-channels-calls-ring.md#push-notifications-explained)) |
| Messaging privacy | High priority; sensitive info goes into chats | **The Sable app is the private channel.** Telegram is dropped as the main channel because it isn't end-to-end encrypted. Signal or Matrix only as optional backups |
| Email | You own a domain and want email to be big | Mailbox hosted off-site (easiest: Fastmail; most private: Stalwart on a VPS). Sable fetches it. [Setup guide](research/email-on-your-domain.md) |
| Smart home | None, apart from Ring cameras (paid plan) | No Home Assistant work. Ring's **official** Partner API (private-use apps) for doorbell, motion and snapshots |
| Hardware | 4 spare computers. An AI server is being built for local models | Sable can move to a spare machine anytime. Voice, vision and local models come with the AI server |
| Model strategy | A big local model most of the time; Ollama's cloud models when nothing private is involved | Needs a **privacy level per chat** (local-only vs cloud-allowed), plus a router |
| Automations | Keep their own chats, but the model may deliver important things into the conversation | Two delivery modes, "here" and "background", and `follow_up` ([design §2](design/core-concepts.md#2-chats-that-wake-themselves)) |
| Quiet hours | None fixed; your schedule changes daily | An availability picture from the morning rundown, calendar, location and driving state ([design §6](design/core-concepts.md#6-knowing-when-to-reach-you)) |
| Calls | Want them, answered from the steering wheel | The app rings through Android's calling framework. Android Auto needs a Play test-track install (beta, test it in the car). Twilio to your AT&T number as fallback |
| Spaces | Full websites, local network allowed, internet blocked unless approved, theming handled by Sable, not only cameras | [Spaces v3](research/spaces-v3.md) plus [design §3](design/core-concepts.md#3-spaces-built-on-sables-engines-not-rebuilding-them) |
| Data | One big shared database every chat can read without asking | [The Library](research/library.md) |
| UI | Should say what something is before you read it | A visual signature per event type ([design §4](design/core-concepts.md#4-notifications-you-understand-before-reading)) |

## Where to start: the shallow end first

**Each stage only depends on the ones before it,** and each is useful on its own. The early stages need no new hardware, no phone and no outside accounts.

### Stage 0: fix what's shaky (small)
1. **Sub-agents always report what they found** ([design §5](design/core-concepts.md#5-sub-agents-always-report-what-they-found-bug-fix-first)). Research has to be trustworthy before Sable does more of it.
2. **Privacy level per chat:** "local only" or "cloud allowed", with the model picker respecting it. The Library and the channels will lean on this.

### Stage 1: the foundation everything shares
3. **Library P0:**
   - hybrid search
   - memories moved in
   - notes, pages, chat outputs and uploads go in
   - sources and trust labels
   - a Library page

   ([research](research/library.md#phases))
4. **Events wake the chat that asked:** "here" vs "background" delivery for watchers, webhooks, reminders, emails and jobs. Plus `follow_up` ("I'll remind you").
5. **Main brain chat:**
   - pinned
   - rolling summaries
   - journal and open loops
   - digests from mini chats
   - morning rundown, which also sets the day's availability

### Stage 2: the phone (when it arrives)
6. **App shell:**
   - Capacitor app wrapping the current UI
   - installed through a **Google Play Internal Testing** track ($25 once; counts as a Play install, which Android Auto needs)
   - Tailscale on the phone
7. **Notifications:**
   - empty FCM pings, content fetched over Tailscale
   - Approve/Deny and reply right in the notification
   - the visual signatures (map thumbnails, progress tracks, snapshots, Live Updates)
8. **Phone signals:**
   - location and geofences
   - share-to-Sable
   - camera
   - availability signals (Android Auto connected, driving, DND, calendar)

### Stage 3: email on your domain
9. **You set up the mailbox and DNS** with the [guide](research/email-on-your-domain.md). Sable gets the **agent mailbox** rules: allowlist, DMARC check, threaded replies, approvals on your phone, send limits.

### Stage 4: Spaces v3
10. **Media and local devices:** "local device" connections, a media proxy, theming tokens injected. Live feeds stop showing as broken.
11. **Space backends:**
    - a container per Space
    - storage and schedules
    - a manifest with approval cards
    - Library collections
    - Spaces can wake their chat
12. **Ring through its official API** (needs a tiny public relay for its webhooks).

### Stage 5: the AI server
13. **Local models and routing:** a big local model as the default, a small router, Ollama cloud models when the chat's privacy level allows.
14. **Library P3:** captions, transcripts, image search, a reranker.
15. **Voice** (Witty or Pipecat, with Sable as the brain), **calls from the app**, and "someone's at the door, I'll call you when you're driving".

### Later
16. **Oni bridge:** Oni → Sable for incidents worth telling you; Sable → Oni for read-only health questions and approved requests.
17. **Optional backup channels:** Signal or Matrix, and Twilio calls to your number.

## Open questions

The full lists are at the bottom of each research doc. These are the ones that block planning:

1. **Stage 0–1 first?** Do you agree with starting there, before the app?
2. **Library and cloud:** may cloud models ever read Library content? Only for chats marked "cloud allowed"?
3. **Email import:** which email goes into the Library: everything, or some labels or senders?
4. **Domain DNS:** who hosts it, and does it already have mail records? Is Fastmail OK, or do you want the self-hosted VPS route?
5. **Main chat in the app:** should it be the **home screen** (open the app and you're talking to Sable), with mini chats a swipe away?
6. **Ring relay:** OK to run a tiny public relay (it only checks Ring's signature and forwards) so Ring events can reach Sable?
