# Research: private channels, calls, Ring, and knowing when to call

*Researched 2026-11-20. This updates [reaching-you.md](reaching-you.md) now that privacy is the top priority. Items marked **unverified** need testing on the phone or in the car.*

## The big change: the Sable app *is* the private channel

Telegram is out as the main channel, because its bot chats aren't end-to-end encrypted. The most private channel is **Sable's own Android app talking to your server over Tailscale**:

- Messages travel encrypted (WireGuard) between your phone and your server. **No company sees the content.**
- Tailscale's coordination server only knows which devices exist and their IPs.

### Push notifications, explained

**Why Android needs a push service:** Android doesn't let apps keep their own always-on connections (battery). Instead, Google Play Services keeps **one** shared connection from the phone to Google, and every app's push messages ride on it. That's FCM. Your server asks Google to "deliver this to Sable on my phone", and the phone wakes the app.

**What Google sees:** FCM isn't end-to-end encrypted, so Google *could* read whatever is in the push. **The plan is to put nothing in it:**
1. Sable sends an empty "wake up" ping.
2. The app wakes, connects to your server over Tailscale, and fetches the actual message.
3. Google sees only that *a* ping happened, plus its timing and size.

**Rules that come with it:**
- Always show a notification after an urgent ping. Android punishes apps that use urgent pings without showing anything.
- Pushes arrive over normal internet; content comes over Tailscale. Both work side by side.

**Alternative with zero Google:** self-hosted ntfy/UnifiedPush over Tailscale. It keeps its own connection open, which costs battery and can be killed. Tailscale itself has a known battery-drain issue on Android. Not recommended as the main path.

**Tailscale settings on the phone:**
- Turn on **Always-on VPN**.
- **Don't** turn on "Block connections without VPN". It's reported to stop Tailscale reconnecting and to break Android Auto.
- Set Battery to **Unrestricted** for Sable and Tailscale.

### Other channels, as backups

| Channel | Who can see content | End-to-end encrypted | Buttons / rich UI | Notes |
|---|---|---|---|---|
| **Sable app + content-free FCM** | Nobody | Yes (WireGuard) | Full: actions, reply, Live Updates, calls | **Primary** |
| Sable app + ntfy over Tailscale | Nobody | Yes | Full | Battery cost; zero Google |
| Matrix (self-hosted) + Element X | Nobody (you host it) | Yes, if the bot enables encryption | Weak: no inline buttons | Good secondary chat |
| Signal via signal-cli | Nobody | Yes | None | **No official bot API** in 2026. Needs its own number; breaks when Signal changes things |
| SimpleX | Nobody | Yes | Bot commands | Niche, active |
| Telegram / SMS / RCS | Telegram or the carrier | No | Varies | Avoid for sensitive content |

## Calls

**How the app calls you:**
- Jetpack **core-telecom** (Android's official calling-app library) makes the app ring like a real phone call. Audio goes over WebRTC to your server through Tailscale, so it's private.
- That's for later: the voice side needs the GPU server.

**Android Auto is the tricky part:**
- Google's Android Auto support for third-party calling apps is in **beta**. The app needs core-telecom plus a small Car App Library piece, and on Google Play it's only allowed on **Internal or Closed testing tracks**.
- Android Auto wants apps to look "installed from Play". Its "unknown sources" developer switch reportedly doesn't cover these apps.
- One open issue reports that even Google's own sample doesn't show the incoming-call screen in Auto while WhatsApp's does. That suggests a partner allowlist (**unverified**).

**Plan:**
1. Install your own app through a **Google Play Internal Testing track**. A one-time $25 developer account makes it count as a Play install, with no public listing. It's also the cleanest answer to Google's 2027 sideloading rules.
2. **Test in your car early.** Even if Auto's call screen doesn't appear, the call audio should still go through the car's hands-free. Whether the steering-wheel answer button works without the Auto screen is **unverified**.

**Fallback:** Sable calls your real AT&T number through Twilio or Telnyx (about 1–2¢ a minute). Answering from the wheel works in every car, but the provider hears the audio. Keep this for when the app can't be reached.

## Notifications you can understand at a glance

These Android styles work for a sideloaded or test-track app:

| Style | Use in Sable |
|---|---|
| **Live Updates** (Android 16, `ProgressStyle`) | Pinned progress chip in the status bar and lock screen. For things *you started* that are happening now: "driving to class, 12 min", "a sub-agent is researching (3/5 sources)", "delivery out now". On the Nothing Phone (4a), Nothing OS **mirrors Live Updates onto the Glyph Bar** automatically |
| **CallStyle** | Sable calling you (Answer/Decline) |
| **MessagingStyle** | Sable chat with inline reply |
| **BigPictureStyle** | A doorbell snapshot, or a **map thumbnail** drawn by the server for location events |
| **Custom layout** (DecoratedCustomViewStyle) | Icon-rich approval cards: what will happen, with icons, then Approve/Deny |

**Limits:**
- Live Updates can't use custom layouts.
- Google's policy says Live Updates aren't for general alerts, chat messages or package *tracking*. A delivery that's arriving *now* fits; a "shipped" notice doesn't. It isn't enforced off-Play, but follow it so the chip stays meaningful.
- Nothing's Glyph Matrix SDK covers the Phone (3) and (4a) **Pro**, not the standard 4a. There's no public SDK for the 4a's Glyph Bar beyond the automatic Live Updates mirroring.

## Ring

**Ring now has an official Partner API**, including "**Private Use Apps**": up to 10 accounts, no certification, which suits a personal project. Each linked account needs a paid Ring plan, which you have.

**What you get:**
- Signed webhooks for **doorbell press** and **motion**, including person and package-delivery smart alerts.
- **Live video** (WebRTC, or RTSP through Ring's July 2026 bridge), **snapshots** and **clips**. A watermark is mandatory since June 2026.
- **Not** two-way talk. Officially, the only audio out is playing a sound on a chime.

**Catches:**
- The webhooks need a public HTTPS address. Ring can't reach a Tailscale-only server, so this needs Tailscale Funnel on one path or a tiny public relay that only checks Ring's signature and forwards.
- Cameras with Ring's end-to-end encryption turned on are invisible to the API.

**The unofficial option:** `ring-client-api` and ring-mqtt are maintained, and v12 fixed two-way audio. They log in as you with full account access. Against Ring's terms in spirit; can break.

**"Someone's at the door, Sable calls me, I talk to them":**
- Fully, that means: doorbell webhook → Sable calls your app → the server bridges Ring's video and the *unofficial* talk-back audio into the call. A lot of fragile work.
- **Recommended instead:** Sable announces it. "Someone's at the door", with a snapshot notification, or spoken during a call if you're driving. The Ring app's own call-style alert handles talking to them.

**Ring and email:** doorbells and cameras only send push alerts, not email, so an email watcher can't catch them.

## Knowing when to call

The phone app can read these and report them to Sable over Tailscale:

| Signal | API |
|---|---|
| **Android Auto connected** (most reliable "driving") | `CarConnection` → `CONNECTION_TYPE_PROJECTION` |
| In a vehicle | Activity Recognition `IN_VEHICLE` |
| Car Bluetooth connected | `BLUETOOTH_CONNECT` |
| At a known place (campus, work, home) | Geofences |
| Calendar busy | `CalendarContract` availability (Sable also reads Google Calendar directly) |
| Do Not Disturb / Driving mode | `getCurrentInterruptionFilter()` |
| Already on a call | `TelephonyManager` call state |

**Rule of thumb:** call when driving (Auto connected or in a vehicle), no busy calendar block, DND off or Driving mode allows it, and not already on a call. Otherwise notify, and **wait for the next good moment** if it can wait ("class ends in 10 minutes, I'll call then").

## Sources

- FCM: [encryption](https://firebase.google.com/docs/cloud-messaging/encryption) · [message priority](https://firebase.google.com/docs/cloud-messaging/android/message-priority) · [network configuration](https://firebase.google.com/docs/cloud-messaging/network-configuration)
- Tailscale: [battery drain](https://tailscale.com/docs/reference/troubleshooting/mobile/battery-drains) · [issue #6912](https://github.com/tailscale/tailscale/issues/6912)
- Calls and Android Auto: [Android Auto calling](https://developer.android.com/training/cars/communication/calling) · [platform-samples #158](https://www.github.com/android/platform-samples/issues/158) · [UnknownAuto](https://androidauthority.com/android-auto-unknownauto-tool-3730284) · [core-telecom VoIP apps](https://developer.android.com/develop/connectivity/telecom/voip-app) · [CarConnection](https://developer.android.com/training/cars/apps/library/connection-api)
- Notifications: [Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update) · [Progress-centric notifications](https://developer.android.com/about/versions/16/features/progress-centric-notifications) · [Nothing OS 4.1](https://9to5google.com/2026/03/17/nothing-phone-4a-debuts-these-new-features-in-nothing-os-4-1/) · [GlyphMatrix kit](https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit)
- Ring: [Partner API](https://developer.amazon.com/docs/ring/api-documentation.html) · [release notes](https://developer.amazon.com/docs/ring/release-notes.html) · [FAQ](https://developer.amazon.com/docs/ring/developer-faq.html) · [ring-client-api](https://www.npmjs.com/package/ring-client-api) · [Ring email alerts](https://community.ring.com/t/whats-in-email-notifications/244851)
- Messaging: [matrix-bot-sdk encryption](https://turt2live.github.io/matrix-bot-sdk/tutorial-encryption.html) · [simplex-chat](https://www.npmjs.com/package/simplex-chat)
- Verification: [Android developer verification](https://support.google.com/android-developer-console/answer/16561738)
