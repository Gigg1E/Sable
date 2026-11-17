# Connecting Google Calendar and Gmail

Sable uses **Google's official MCP servers** for Calendar and Gmail. Google still has them in **Developer Preview**, so setup takes more steps than most connectors. It's a one-time job.

> **Just want Sable to read your calendar?** Use **Settings → Connectors → Calendar feeds (iCal)**. Paste the *Secret address in iCal format* from Google Calendar (Settings → your calendar → Integrate calendar). It works with personal Gmail, needs no Google Cloud setup, and lets Sable read events and find free time. The only limit is that it's read-only: Sable can't add or change events through it. The rest of this page is for the official connectors, which can also make changes.

> **Check first: what kind of Google account do you have?**
> Google's preview program asks for a **Google Workspace account**: a work, school or paid Google account on your own domain. Google doesn't say personal `@gmail.com` accounts qualify. If you only have a personal Gmail, read [No Workspace account?](#no-workspace-account) before spending time on the rest.

Errors you'll see if a step is missing:

| Error from Google | Missing step |
|---|---|
| `redirect_uri_mismatch` | [Step 5](#5-create-the-oauth-client): the redirect URI isn't registered *exactly* on the client Sable uses |
| `Calendar MCP API has not been used in project … or it is disabled` | [Step 2](#2-enable-the-apis) |
| `Access to this tool requires that your Google Cloud project (…) is enrolled in the Google Workspace Developer Preview Program` | [Step 1](#1-join-the-developer-preview-program) |
| `access_denied` / "app has not completed verification" | [Step 4](#4-set-up-the-consent-screen): add yourself as a test user |
| Asked to sign in again every week | See [Staying signed in](#staying-signed-in) |

---

## 1. Join the Developer Preview Program

1. Create a Google Cloud project if you don't have one: <https://console.cloud.google.com/projectcreate>. Note its **project number**, shown on the project dashboard and in error messages (for example `998488298630`).
2. Open <https://developers.google.com/workspace/preview> and read the **Program Terms**.
3. Fill in the **application form** linked on that page. It asks for:
   - your **Google Workspace account** (email)
   - your **Google Cloud project** (the project number is what grants access)
4. Wait for the confirmation email. Google says it usually takes **a couple of days**.
   - Google adds your account to a Google Group, so your account must be allowed to be added to groups ([how](https://support.google.com/groups/answer/9792489)).
   - Nothing after a week, and nothing in spam? Email `workspace-dpp-mod@google.com`.

Good to know about the terms:
- It's free.
- Preview features may change, and Google may use data sent through preview APIs to improve them.
- Preview APIs can't be used in an app for people **outside your own domain/company**. A personal Sable for you (and people in your Workspace) is fine.

## 2. Enable the APIs

In the **same project**, enable both APIs for each service you want:

| Service | Regular API | MCP API |
|---|---|---|
| Calendar | [Google Calendar API](https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com) | [Google Calendar MCP API](https://console.cloud.google.com/flows/enableapi?apiid=calendarmcp.googleapis.com) |
| Gmail | [Gmail API](https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com) | [Gmail MCP API](https://console.cloud.google.com/flows/enableapi?apiid=gmailmcp.googleapis.com) |

Or with `gcloud`:

```bash
gcloud services enable calendar-json.googleapis.com calendarmcp.googleapis.com --project=PROJECT_ID
gcloud services enable gmail.googleapis.com gmailmcp.googleapis.com --project=PROJECT_ID
```

If you just enabled them, wait a few minutes before trying again.

## 3. Check you're in the right project

Every step uses **one** project: the one enrolled in the preview, with the APIs enabled, and holding the OAuth client. Check the project picker at the top of the Cloud Console on each page. A client created in a different project is the most common cause of confusing errors.

## 4. Set up the consent screen

In **Google Auth Platform**:

1. **Branding** (<https://console.cloud.google.com/auth/branding>): app name (e.g. `Sable`), your email.
2. **Audience** (<https://console.cloud.google.com/auth/audience>):
   - Choose **Internal** if offered (Workspace only: everyone in your domain can sign in, with no test-user list and no 7-day sign-out).
   - Otherwise **External**, and add your account (and anyone else who'll connect) under **Test users**.
3. **Data Access** (<https://console.cloud.google.com/auth/scopes>): add the scopes for what you want Sable to do. Read-only Calendar, per Google's guide:
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
   - `https://www.googleapis.com/auth/calendar.events.readonly`

   To let Sable create or change events, also add `https://www.googleapis.com/auth/calendar.events`. Sable still asks you before every change.

## 5. Create the OAuth client

1. Open <https://console.cloud.google.com/auth/clients/create>.
2. **Application type: Web application.** (Desktop and other types don't work.)
3. Tick **"Use this client for an AI-powered agent"**. Google requires this for its MCP servers.
4. Under **Authorized redirect URIs**, add the URI Sable shows. You'll find it in **Settings → Connectors → Google Calendar** (when adding, or in the connector's details). It's the address you open Sable at, plus `/api/mcp/oauth/callback`, for example:
   ```
   https://myserver.tail1234.ts.net/api/mcp/oauth/callback
   ```
   - It must match **character for character**: `https`, no trailing slash, and include the port if your address has one (e.g. `:8443`).
   - It goes in **Authorized redirect URIs**, *not* "Authorized JavaScript origins".
   - Google only accepts `https` with a real domain name (Tailscale's `ts.net` works) or `http://localhost`. Plain IP addresses are refused.
5. **Save**, then copy the **Client ID** and **Client secret**. Changes can take a few minutes to apply.

One client works for both Calendar and Gmail.

## 6. Connect in Sable

1. Open Sable **at the same address** as the redirect URI.
2. **Settings → Connectors → Google Calendar**. Paste the Client ID and secret, then press **Save and sign in with Google**.
3. Pick your account and approve. You'll land back in Sable with the connector showing a green dot and its tools.
4. Optional: open the connector's details and press **Allow read-only tools without asking**, so checking your calendar doesn't prompt every time. Creating, changing or deleting events still asks.

Then try: *"What's on my calendar this week?"*

## Staying signed in

- Sable asks Google for offline access, so it gets a refresh token and stays connected.
- **External apps in "Testing" status:** Google expires sign-ins after **7 days**. When that happens, Sable shows *sign-in needed* on the connector, and the agent tells you. Press **Connect account** again. To avoid this, use an **Internal** audience (Workspace) instead.

## No Workspace account?

If you only have a personal `@gmail.com` account, Google's official preview servers probably won't work for you yet. Your options:

1. **Calendar feeds (iCal), recommended for reading.** Settings → Connectors → Calendar feeds → Add calendar, then paste Google's *Secret address in iCal format*. Treat that address like a password, and if it leaks, use *Reset* on the same Google page. Feeds are read-only, and Google can take a few hours to show changes in them.
2. **Use a Google Workspace account** if you have one (work, school, or a paid Workspace plan on your own domain). Workspace for Education accounts are eligible too.
3. **Wait for general availability.** Once Google releases these servers publicly, enrollment shouldn't be needed. Steps 2 to 6 stay the same.
4. **Use a community MCP server** that talks to the regular Google Calendar API, which works with personal accounts. Add it as a **Custom** connector that runs a command on your server. It uses its own OAuth client (usually type *Desktop app*) and its own sign-in step. Follow that project's README, and review the code before running it, since it gets access to your calendar.

## Removing access

- In Sable: **Settings → Connectors → (connector) → Disconnect account**, or delete the connector.
- In Google: <https://myaccount.google.com/connections>. Remove the app to revoke its tokens.
