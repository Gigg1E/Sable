# Research: how Sable can reach you outside the website

*Researched 2026-11-20 from official docs. Items marked **unverified** need re-checking.*

## What Sable has today

| Channel | Direction | Notes |
|---|---|---|
| Web Push (PWA) | Sable → you | Approvals with buttons, reminders, routine results |
| ntfy | Sable → you | Push to the ntfy app |
| Discord / Slack webhooks | Sable → you | One-way posts |
| Generic webhooks | Sable → anything | Outputs, plus inbound "push" URLs |
| Email | Sable → anyone | Sent from your own mailboxes (Gmail via Google sign-in, others via app password) |
| Inbox in the app | Both | Notifications, approvals |

Everything except the app itself is **one-way**. You can't reply on any of these channels and have Sable continue the conversation.

## The options

| Channel | Two-way | Buttons | Voice notes | Calls | Cost (2026) | Setup | Official? |
|---|---|---|---|---|---|---|---|
| **Telegram bot** | Yes (you /start it first) | Yes | Send and receive | **No** | Free | Low | Yes |
| Signal (signal-cli-rest-api) | Yes | No | Yes | No | Free plus a spare number | Medium | **No** (reverse-engineered) |
| WhatsApp Cloud API | Yes, within a 24h window | Yes | Yes | Yes (Calling API, after you grant permission) | Paid per message since Oct 2026 beyond 1,000 a month | High (Meta Business setup) | Yes |
| Matrix (self-hosted) | Yes | Limited | Yes | Only with extra work | Free | Medium-high | Open standard |
| Discord bot | Yes (DMs) | Yes | Partial | No | Free | Low | Yes |
| SMS/MMS (Twilio, Telnyx) | Yes | No | MMS only | Same number can call | About $0.008 per text plus carrier fees, $1.15/mo number, US 10DLC registration | Medium (days to weeks) | Yes |
| RCS business | Yes | Yes | Media | No | Per message plus carrier fees | **High** (carrier approval) | Yes |
| **Phone call** (Twilio or Telnyx with Pipecat) | Yes (live) | Keypad presses | n/a | **Yes** | Twilio about $0.02/min, Telnyx about $0.011/min | Medium-high | Yes |
| **Email** (dedicated agent mailbox) | Yes | Links only | Attachments | No | Free to $5/mo | Low-medium | Yes |

## Telegram: the recommended main text channel

- **Official and free.**
- **Long polling** (`getUpdates`) needs no public URL, so it works behind Tailscale or NAT. Webhooks would need public HTTPS on port 443, 80, 88 or 8443.
- **Approvals:** inline keyboards with `callback_data` give Approve/Deny buttons.
- **Streaming replies:** `sendMessageDraft` (Bot API 9.5, March 2026) and Rich Messages (10.1, June 2026). Bot API 10.4 (Nov 2026) adds HTML widgets and ephemeral replies to button presses.
- **Files:** bots can send files up to 50 MB and download up to 20 MB. A self-hosted Bot API server raises these limits.
- **Rate limits:** about 1 message per second per chat.
- **Voice notes:** arrive as OGG/Opus. Download them with `getFile`, then transcribe locally once the GPU server exists. Sable can also reply with voice notes.
- **Location:** live location arrives as one message that keeps getting edited (`edited_message.location`). How this behaves in practice is **unverified**, so test it.
- **Privacy:**
  - Bot chats are **not end-to-end encrypted**; Telegram can read them.
  - Accept messages only from your numeric user ID.
- **Calls:** a bot can't call you. The Bot API has no call methods.
  - Calling would need a second Telegram *user* account (MTProto "userbot"). That's against the spirit of an official integration and puts the account at risk. Not recommended.
  - Use voice notes, plus a real phone call for urgent things.
- **Mini Apps:** Sable's UI can open inside Telegram. This probably needs public HTTPS (**unverified**). Low priority.

## Real phone calls

- **Twilio:** the call answers with `<Connect><Stream url="wss://…">`, which carries audio both ways over a WebSocket (8 kHz μ-law).
  - US pricing: about $0.014/min outbound, $0.0044/min for the audio stream, and $1.15 a month for the number.
- **Telnyx:** about $0.0105/min (my arithmetic from their price list).
- **Frameworks:**
  - **Pipecat** (recommended) has Twilio, Telnyx and Plivo audio transports, and can use local Whisper, Kokoro/Piper and Ollama.
  - **LiveKit Agents** places calls over SIP.
  - **Vocode** has stalled since 2024. Avoid it.
- **Fully self-hosted:** Asterisk or FreeSWITCH with a SIP trunk. Cheapest per minute, but the most operational work (NAT and RTP).
- **Catch:** Twilio and Telnyx must reach a **public `wss://` URL**. Options:
  - Tailscale Funnel on one path
  - Cloudflare Tunnel
  - a small VPS relay

  Protect it with Twilio's request signature and a secret path.

## Email as a channel (for work and school)

- **Use a dedicated agent mailbox,** for example `sable@yourdomain` or `you+sable@…`. Your own mailboxes stay for reading and sending *your* mail.
- **Checking incoming mail:**
  1. Read the `Authentication-Results` header and require DMARC pass, or DKIM aligned with the From domain.
  2. **Also** require the sender to be on an allowlist of your work and school addresses.
  3. If either check fails, quarantine the message and ping you.
- **Threading:** set `Message-ID`, `In-Reply-To` and `References` so replies stay in one thread.
- **Security:**
  - Treat email bodies as untrusted data, not instructions.
  - Never act on "forward everything to X".
  - Sensitive actions need an approval tap on your phone.
  - Only reply to the verified sender.
- **Work and school accounts:**
  - Auto-forwarding out is often blocked, so you'd email Sable yourself.
  - Sending work documents to a personal agent may break your employer's or school's data policy. That's your call.

## One brain, many channels

How OpenClaw-style agents do it:
- All of the owner's direct messages on every channel go into **one main session**.
- Each channel is a thin adapter.
- Replies go back to the channel the message came from.
- Proactive messages go to the last-used or preferred channel.
- The owner is pinned by ID so nobody else can hijack the route.

**Urgency ladder:**

| Level | Behavior |
|---|---|
| Info | Batched into a digest |
| Normal | App push or Telegram, silent during quiet hours |
| High | Telegram with sound, plus high-priority push |
| Critical | If not acknowledged within N minutes, a phone call |

One acknowledgement anywhere clears the alert on every channel.

**Anti-spam:**
- Quiet hours (critical only).
- Per-channel rate caps, and dedupe by event.
- Edit one message instead of posting new ones.
- A daily call budget.
- "Snooze 1h" buttons.

## Recommended order

1. **Telegram:** long polling, owner-ID lock, approval buttons, files, voice notes (transcribed later on the GPU server), location, quiet hours and urgency routing.
2. **Agent mailbox:** DMARC check plus allowlist, threaded replies, approvals sent to your phone.
3. **Phone calls for critical alerts:** Twilio or Telnyx with Pipecat. First "call, say the alert, press 1 to acknowledge", then full conversations once local voice exists.
4. **Optional:** SMS on the same number, Signal, a Telegram Mini App. Skip WhatsApp and RCS.

## Sources

- [Telegram Bot API changelog](https://core.telegram.org/bots/api-changelog) · [Bot FAQ](https://core.telegram.org/bots/faq) · [MTProto calls](https://core.telegram.org/api/calls) · [Mini Apps](https://core.telegram.org/bots/webapps) · [Live location](https://core.telegram.org/api/live-location)
- [WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [WhatsApp calling pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/pricing/)
- [Twilio Voice US pricing](https://www.twilio.com/en-us/voice/pricing/us) · [Media Streams](https://www.twilio.com/docs/voice/media-streams) · [A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) · [Telnyx voice pricing](https://telnyx.com/pricing/voice-api)
- [Pipecat Twilio WebSockets](https://docs.pipecat.ai/guides/telephony/twilio-websockets) · [LiveKit outbound calls](https://docs.livekit.io/telephony/making-calls/outbound-calls.md)
- [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) · [OpenClaw channel routing](https://docs.openclaw.ai/channels/channel-routing)
- [Securing an agent inbox](https://mails.ai/blog/securing-agent-email-inbox-against-spoofing) · [Preventing prompt injection (Nylas)](https://developer.nylas.com/docs/cookbook/agents/prevent-prompt-injection/)
