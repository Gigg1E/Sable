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

## Approving from the notification

Push notifications for approvals have **Approve** and **Deny** buttons, so you don't need to open the app. This works on Android, Windows and macOS (Chrome, Edge, Firefox). On iPhone, iOS doesn't support notification buttons, so tapping opens the approval in the app.

## Background runs only notify you when there's something to say

A check that found nothing new never notifies you, and the same news is never sent twice. See [Routines](#routines).

*(Watchers, webhooks and Spaces are being rebuilt to this design. This page grows as each part lands.)*
