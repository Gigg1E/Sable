# How Sable's automations work

Sable has four kinds of automation, each with one job:

| | What it is | Example |
|---|---|---|
| **Routines** | A **time**, a **topic** and a **prompt**. At that time the prompt runs in a background chat, either to tell you something or to do a job itself. | "Remind me to pay rent on the 1st", "Every morning, the weather", "At 8pm email Sam what we found" |
| **Watchers** | Something to **monitor**. When something new arrives or changes, a prompt runs with what happened. | "If this drops below $40, add it to my cart", "When a vendor emails me, summarize it" |
| **Webhooks** | Places Sable **pushes to** (Discord, Slack, any URL), or links Sable makes for other things to push to. | "When a game price drops, post it to my Discord" |
| **Spaces** | Live mini apps that tie it together. | A shopping list whose prices update from watchers |

## Routines

- When you ask for one, Sable shows a **New routine** card with the time, the topic and exactly what it will do each time it runs.
  - **Approve:** its runs can take those steps without asking you again, so an 8 PM routine doesn't stall waiting for you. Purchases always ask, and so does anything you restricted ("but ask me before sending").
  - **Ask me each time:** its runs ask before every action that needs approval.
- If something is missing when you set it up (the time, who to email), Sable asks before creating it. If something is missing when it runs, you get a notification with a short question. Reply in that routine's chat and it finishes.
- On the **Routines** page, each routine has two switches:
  - **Every run / Only when new:** whether it tells you every time, or only when there's something new.
  - **Runs on its own / Asks first:** whether its steps are pre-approved.

## Watchers

A watcher monitors something and runs a prompt when something new happens. Like routines, creating one shows a card you approve. **Approve** pre-approves the steps its runs take, except purchases and anything you restrict.

| Source | Fires when | How fast |
|---|---|---|
| **Email** | New mail arrives, optionally only from certain senders (name, address or domain) or with a subject | Within seconds (live IMAP connection), with a fallback check every 15 min |
| **Calendar** | An event is added to your calendar feeds, or is about to start (X minutes before) | Every check |
| **Web** | A page or API changes: price below/above, % drop, text appears, any change | Every N minutes (5+, polite 60 for shops) |
| **Push** | Another service calls a private URL Sable gives you (listed under Webhooks → Push URLs) | Instantly |

What happens when it fires is a prompt, for example:
- "The price dropped below $40: add 1 of it to my cart and tell me."
- "Summarize the email and tell me if it needs a reply."
- "Reply 'Thanks, got it' to the sender."

The runs happen in the watcher's own chat under **Automations** in the sidebar, where you can also talk to it. Watchers check in code, with no model call, so nothing runs (and nothing pings you) until something new actually matches.

## Webhooks

**Webhooks → Outputs** are places Sable pushes to: a Discord or Slack channel, ntfy, or any URL.
- Paste a link on the Webhooks page, or give it to the agent in chat ("save this as Deals Discord"). The agent asks before saving.
- After that, anything can send to it by name: "post price drops to Deals Discord". That works from a watcher, a routine or a chat.
- Each output receives **only what's sent to it**, unless you also forward your notifications to it (important or all).
- Discord and Slack get formatted messages. Other URLs get JSON `{ title, body, data }`.

**Webhooks → Push URLs** are private links other services call to wake Sable (GitHub, Home Assistant, a script). They work like a watcher: ask for one ("give me a URL that tells me when my build fails"), give it to the other service, and each call runs the prompt.

If you ask for something to go "to my webhook" and none is saved, the agent asks whether you have a link to paste or want Sable to make a push URL.

## Email accounts

**Settings → Connectors → Email → Add email account.** Pick the provider, enter the address and an **app password** (not your normal password):

- **Gmail:** turn on 2-Step Verification, then Google Account → Security → **App passwords**.
- **iCloud:** account.apple.com → Sign-In and Security → **App-Specific Passwords**.
- **Yahoo:** Account Security → **Generate app password**.
- **Outlook.com:** Microsoft often blocks app passwords for IMAP. If **Test** fails, use the Microsoft 365 connector.
- **Other:** your provider's IMAP/SMTP servers (also works with local bridges such as Proton Mail Bridge).

Connect several and mark one **Default**. The agent can then search, read and send email (sending asks you unless a routine or watcher you approved does it), and watchers can watch any of them.

## Approving from the notification

Push notifications for approvals have **Approve** and **Deny** buttons, so you don't need to open the app. This works on Android, Windows and macOS (Chrome, Edge, Firefox). On iPhone, iOS doesn't support notification buttons, so tapping opens the approval in the app.

## Background runs only notify you when there's something to say

A check that found nothing new never notifies you, and the same news is never sent twice. See [Routines](#routines).

## Memory

Two kinds, shown as tabs on the **Memory** page (click a memory's label to switch it):
- **About you:** where you live, preferences, how you work. Always in the agent's mind.
- **People & things:** contacts, places, accounts, items ("Sam is my landlord, sam@example.com"). Only brought up when a message is about them.

- **How-to:** how you like a kind of request handled, learned from how you instruct and correct it. Written as *"When <situation>: <what to do, which tools>"*, e.g. *"When tracking a package: use an email watcher on the carrier's shipping emails, not a routine"* or *"When posting deals: send them to the Deals Discord webhook"*.

How-to memories are learned automatically. When you correct Sable or give it a standing instruction ("no, use a watcher for that", "from now on send those to Discord", "don't search the web for this, check my email"), it does it your way and saves the lesson. Next time a similar request comes up, the matching how-to is in front of it, and **the tools it names are loaded** so it can follow it. Edit, re-label or delete them on the Memory page (How-to tab), or tell Sable a how-to is wrong.

Plain tasks and requests ("monitor my email", "remind me…") are refused as memories, because they belong in routines and watchers. Saving the same fact twice updates it instead of duplicating it. The agent also sees a short list of your running routines and watchers, so it knows what's already set up.

## Tool and memory selection (helper model)

A small embedding model (`embeddinggemma`, about 300 MB) installs itself in Ollama the first time Sable sees Ollama. Its status and an **Install now** button are in **Settings → Models → Helper model**.

- For each message it picks the relevant **tool groups** (email, watchers, web, files…), plus groups used in the last few turns and a few core tools. A typical message gets 10-20 tools instead of 50+, which makes smaller models far less likely to pick the wrong one.
- The model can always call **tools_search** ("send an email") to load anything else.
- The same model picks which "people & things" memories are relevant.
- Without Ollama, it falls back to keyword matching. Turning it off sends every tool and memory, as before.

## Spaces

Spaces are live mini apps the agent builds: trackers, dashboards, shopping lists, planners. The agent decides what's on them and how they're laid out. **Sable controls the styling**, so they always fit the app:

- **Built-in look:** headings, buttons, inputs, tables and lists are styled for light and dark mode automatically. There are ready-made pieces too: cards, grids, badges, stats, progress bars, tabs.
- **Their own personality:** each space can pick an accent color, corner style (sharp, soft, round), font (sans, serif, mono, rounded) and spacing. Accents are lifted slightly in dark mode so they stay readable.
- **No more black-on-dark text:** hard-coded black, white and grey colors in a space's code are switched to theme colors, and any text that's still unreadable is fixed when the space loads.
- **Live data:** a space renders from its data. When the agent, a watcher or a routine updates that data ("set the new price"), an open space updates instantly, without reloading. Example: a shopping-list space with one watcher per item writing its current price.
- **Buttons that do things:** a space button can ask a quick question, or start a real task with the agent's tools ("check every price now and update the list"). That task runs in the space's chat.
