# Google: Gmail and Calendar with "Sign in with Google"

**Settings → Connectors → Google → Sign in with Google.** One sign-in gives Sable:

- **Gmail:** search, read and send mail, plus email watchers that notice new mail within seconds. No app password.
- **Google Calendar:** read your calendars (`calendar_events`, free time, calendar watchers) and add events (`calendar_create_event`, which asks you first unless an approved routine or watcher does it).

It uses Google's official OAuth sign-in. Gmail works through Gmail's built-in mail protocol with OAuth (`https://mail.google.com/`). Calendar uses the regular Calendar API. Neither needs Google's developer preview program or a Workspace account, so personal Gmail works.

## The one-time part: your own Google client

Google requires every app that signs people in to have its own **OAuth client**. Apps like Thunderbird ship theirs. A self-hosted app has to use yours. It takes about 5 minutes, and Sable's Google section walks you through it:

1. **[Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)**: create a project if asked, then **Create client → Web application**. If you made one for the old Google connector, reuse it. Sable copies its ID and secret over automatically.
2. **Authorized redirect URIs:** add the address shown in Sable's Google section: the address you open Sable at, plus `/api/mcp/oauth/callback`. Example: `https://myserver.tail1234.ts.net/api/mcp/oauth/callback`. If you set up the old connector, it's already there. Google needs `https` with a real domain (Tailscale `ts.net` works) or `http://localhost`.
3. **[Audience](https://console.cloud.google.com/auth/audience):**
   - Choose **Personal** if it's offered. Only your Google account can sign in, with no verification and no weekly sign-outs.
   - Otherwise keep **External** and press **Publish app**. In "Testing" mode, Google signs you out every 7 days.
   - Google will warn that the app isn't verified. It's your own app, so choose **Advanced → Go to …**.
4. **Turn on the [Google Calendar API](https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com)** for the project. Gmail needs nothing extra.
5. Paste the **Client ID** and **Client secret** into Sable, then press **Sign in with Google**. Do it from the same address you registered in step 2.

You can link several Google accounts. Each shows up as a mailbox (watchers and email tools can pick it) and its calendars are included.

## Staying signed in

- Sable keeps a refresh token (stored encrypted) and renews access every hour on its own.
- If Google ends the sign-in, Sable notifies you and shows **Sign in again** on the account. That happens when you change your Google password, remove Sable from your connected apps, or are on a "Testing" app after 7 days.
- To unlink, use the trash icon in Sable, or remove the app at [myaccount.google.com/connections](https://myaccount.google.com/connections).

## Errors

| You see | Fix |
|---|---|
| `redirect_uri_mismatch` | The address in step 2 must match **character for character** (https, no trailing slash, port if any), on the client whose ID is in Sable. Open Sable at that same address. |
| `invalid_client` | The Client ID or secret in Sable is wrong, or belongs to another project. |
| "Access blocked: app not verified" with no Advanced link | Your account isn't allowed. Use Personal audience, or add yourself under Test users / publish the app. |
| "The Google Calendar API isn't enabled" | Do step 4, wait a minute, try again. |
| "Google ended the sign-in" | Press **Sign in again** on the account. |

## Other options

- **Calendar feeds (iCal):** read-only, no Google Cloud setup. Settings → Connectors → Calendar feeds.
- **App password mailboxes** for other providers (iCloud, Yahoo, others): Settings → Connectors → Email.
