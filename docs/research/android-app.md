# Research: an Android app for Sable

*Researched 2026-11-20 from official Android, Play, Firebase and Capacitor docs. Items marked **unverified** need checking on a real device or a primary source.*

## Recommendation

Build a **Capacitor 8** app that loads the existing React UI. Write the parts that must work while the app is closed as a few **small Kotlin plugins**: push, background location and geofences, and incoming calls.

**Installing it:**
- Install it **outside the Play Store**: sideload it, and keep it updated with Obtainium or straight from Sable.
- Register the package name now under a free **limited distribution account**, so nothing breaks when Google's developer verification goes global in 2027.

**Push:** use **FCM** for wake-ups. ntfy/UnifiedPush is an optional fully self-hosted fallback.

**"Sable calls me"** comes in stages:
1. A high-priority notification that opens a voice screen.
2. Later, Jetpack **core-telecom** for a real incoming-call screen, once the GPU voice server exists.

## Packaging options

| Option | Background location | Camera | Reliable push + buttons | Incoming-call UI | Reuses the React UI | Effort |
|---|---|---|---|---|---|---|
| Installed PWA (today) | No (page must be open) | Yes, while open | Web Push with action buttons. No inline reply, delivery when idle not guaranteed | No | 100% | None |
| TWA (Bubblewrap/PWABuilder) | No (foreground only) | Same as PWA | Same as PWA | No | 100% | Low |
| **Capacitor** | **Yes** (plugin or Kotlin foreground service / geofencing) | **Yes** | **Yes**: FCM + native buttons, inline reply, works while killed | **Yes** (Kotlin plugin: core-telecom + CallStyle) | ~90% | Medium |
| Native Kotlin/Compose | Yes | Yes | Yes | Yes (best) | 0%, full rewrite | High |
| React Native/Expo | Yes | Yes | Yes | Yes (community libraries) | Logic only; the UI is rebuilt | Medium-high |

- Only native code can request background location, run foreground services, show full-screen intents or register with Telecom. That rules out the PWA and the TWA.
- Capacitor 8 shipped in December 2025, and 8.5 in July 2026.
- Code that runs while the app is closed (push, geofence, call) must be plain Kotlin. When a push or geofence fires, the WebView usually isn't running.

## Installing a personal app in 2026: developer verification

Source: [developer.android.com/developer-verification](https://developer.android.com/developer-verification).

**Timeline:**
- **Aug 2026:** limited distribution accounts and the "advanced flow" launched.
- **Sept 30, 2026:** enforcement started in **Brazil, Indonesia, Singapore and Thailand** only. There, unregistered package names can't be installed on certified Android 8+ devices.
- **2027:** global rollout ("all apps on certified Android devices"). No exact date yet.

**Ways to install your own app:**
- **ADB is exempt:** `adb install` from your own computer keeps working for unregistered apps.
- **Advanced flow, for installing unverified apps without adb:**
  1. Turn on developer mode and confirm nobody is coaching you.
  2. Restart, then wait a one-time 24 hours.
  3. Confirm with biometrics.
  4. Allow unverified installs for 7 days or indefinitely.

  After that, each install shows a warning with "Install anyway".
- **Limited distribution account (free):**
  - No government ID is needed. You need a Google account with 2-Step Verification, a payments profile and a contact email.
  - You register package names and authorize a capped number of devices through a QR or link handshake.
  - The cap is 20 or 50 devices; sources disagree (**unverified**).
  - **Do this now** and keep the signing key safe, because registration ties the package to that key.

**Google Play** (not needed for one user):
- $25 one-time fee (**unverified** on an official Google page).
- **Internal testing** (up to 100 testers, no review) is the easy route if you ever want Play to handle updates.
- Downsides: Play's background-location review, and Play revokes full-screen intent for apps that aren't calling or alarm apps.

**Updates without Play:**
- Obtainium (works with GitHub releases, including a private repo with a token, or any URL).
- A self-hosted F-Droid repo.
- **Sable serving its own APK**, with the app self-updating via `setRequireUserAction` on Android 12+.

## Push

- **FCM:** the most reliable and battery-free option.
  - The server only makes outbound calls, so it doesn't need to be publicly reachable.
  - High priority wakes the phone from Doze. But high-priority messages that don't lead to a visible notification get deprioritized over 7 days.
  - Send **small data-only pushes** ("fetch event X") and pull the content over Tailscale, so content never goes through Google.
- **ntfy / UnifiedPush:** fully self-hosted.
  - Reliable only when ntfy runs as a foreground service with battery optimization off. That means a permanent notification and some battery drain.
  - If the server is Tailscale-only, the phone's VPN must always be on.
- **Web Push (today's PWA):** basic alerts and action buttons only. No inline reply, no call style, no native logic while closed.
- **Approve/Deny and inline reply:** `NotificationCompat.Action` with a BroadcastReceiver that POSTs to Sable, and `RemoteInput` for replies. This needs native code.

## Background location (Android 14–17)

**Permissions:**
- Ask for fine/coarse location first.
- Then, separately, ask for `ACCESS_BACKGROUND_LOCATION`; the user picks "Allow all the time" in Settings.
- In the background, the app gets location only a few times an hour.

**"Remind me when I get to the store":**
- Use the **Geofencing API** in Play Services. It's battery-friendly and allows up to 100 fences.
- Sable sends the fences to the phone; the phone reports enter and exit.
- Expect about 2–3 minutes of lag, and use a radius of 100–150 m or more.

**Live sharing on demand:** a `foregroundServiceType="location"` service with a visible notification, running only while you're sharing.

**Android 17 (API 37) changes that matter:**
- Background audio needs a foreground service.
- Background activity launches are stricter.
- There's a new `ACCESS_LOCAL_NETWORK` permission for LAN addresses. Whether Tailscale 100.x addresses count as local is **unverified**.

**Privacy:**
- Send location only on events (a geofence or an explicit share), coarse by default.
- Use TLS over Tailscale.
- Set a retention limit on the server.
- Show an on/off toggle and a log in the app.

## "Sable calls me"

**How WhatsApp, Signal and Telegram ring you in 2026:**
1. A high-priority FCM data message wakes the app.
2. The app registers the call with **Jetpack core-telecom** (`CallsManager.addCall`, `MANAGE_OWN_CALLS`, a `phoneCall` foreground service on Android 14+).
3. Within 5 seconds it posts a `CallStyle` notification with a full-screen intent.

Headset, Bluetooth, Wear and Android Auto answer buttons then work for free.

**Full-screen intent:** Play revokes it for apps that aren't calling or alarm apps. Check `canUseFullScreenIntent()` and send the user to the settings screen if needed. A sideloaded app should keep it (**test on the device**).

**Audio:**
- WebRTC to the voice server.
- **Pipecat** has an Android SDK with a direct WebRTC transport. Check how fresh its releases are.
- **LiveKit** is more polished but is more infrastructure.
- Android 17's background-audio rules favor doing call audio in native code, not the WebView.

**Phase 1 shortcut** (about 1 day of work, versus 1–2 weeks for core-telecom): a high-priority "Sable wants to talk" notification on an alarm-style channel with Answer and Decline buttons that opens the voice screen.

## Other things the app can do

- **Share to Sable:** an `ACTION_SEND` intent filter. Share a link, photo, PDF or screenshot to Sable.
- **Quick Settings tile** ("Talk to Sable", "Share location") and **home-screen widget** (Glance).
- **Default assistant** (long-press power): third-party apps can hold the assistant role, as ChatGPT and Perplexity do. Reports say OEM updates sometimes reset it (**unverified**).
- **Android Auto:** messaging and calls work through notifications and core-telecom. Apps not installed from Play need "unknown sources" turned on in Auto's developer settings.
- **Wear OS:** notifications and call answering mirror automatically.
- **Tailscale:** run the app as an always-on VPN. FCM doesn't depend on Tailscale.

## Proposed phases

0. **(Days)**
   - Wrap the UI in Capacitor.
   - Camera and photo picker, and the share target.
   - FCM data pushes with native Approve/Deny and inline reply.
   - Install via adb, and register the package under the free account.
1. **(1–2 weeks)**
   - Geofence reminders and on-demand location sharing.
   - Server endpoints for fences and transitions.
   - Self-updates served by Sable.
2. **(When the GPU server exists)**
   - Voice screen with Pipecat/Witty.
   - The "call" as a high-priority notification.
3. **Later**
   - core-telecom incoming calls.
   - Live camera to Sable on request.
   - QS tile and widget, and optionally the assistant role.

## Open questions

- Which country? If it's BR, ID, SG or TH, enforcement is already active.
- Is routing push metadata through Google's FCM acceptable?
- Is Sable reachable only over Tailscale, or also on the public domain?
- Live camera while the phone is locked? That raises privacy issues and Android 14+ camera foreground-service rules.

## Sources

- [Android developer verification](https://developer.android.com/developer-verification) · [March 2026 blog](https://android-developers.googleblog.com/2026/03/android-developer-verification.html) · [June 2026 blog](https://android-developers.googleblog.com/2026/06/android-developer-verification.html) · [Limited distribution](https://developer.android.com/developer-verification/guides/limited-distribution)
- [Capacitor 8](https://ionic.io/blog/announcing-capacitor-8) · [Capacitor 8.5](https://ionic.io/blog/capacitor-8-5-released)
- [FCM message priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority) · [ntfy on phones](https://docs.ntfy.sh/subscribe/phone) · [UnifiedPush](https://unifiedpush.org/)
- [Background location](https://developer.android.com/develop/sensors-and-location/location/background) · [Android 17 behavior changes](https://developer.android.com/about/versions/17/behavior-changes-17) · [Local network permission](https://developer.android.com/privacy-and-security/local-network-permission)
- [core-telecom](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom) · [Full-screen intent limits](https://source.android.com/docs/core/permissions/fsi-limits) · [Pipecat Android](https://docs.pipecat.ai/client/android/introduction)
- [Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465) · [Play location policy](https://support.google.com/googleplay/android-developer/answer/9799150) · [ChatGPT as default assistant](https://9to5google.com/2025/03/14/chatgpt-default-assistant-android/)
