# Sable's plan: the hub for everything it will do

*Built 2026-11-21.* One place to see what Sable intends to do today and this week, and the time it set aside for you. You can correct it right there instead of going through Duties, Routines, Watchers and Webhooks separately.

## Two kinds of plan items

| Who | What it is | What happens at the time |
|---|---|---|
| **Sable** | Something Sable will do itself: check a refund, draft the grocery list, follow up on an assignment | Sable runs it, in the chat it came from (or "Plan"). It marks the item done or skipped and reports through the attention gate. |
| **You** | Time Sable blocked out for you: an assignment 8–10 pm, the gym, an errand | You get a nudge at the start. That nudge is urgent, so it comes through even in quiet hours; Sable only blocks time when you're awake. The next check-in follows up. |

**Where items come from:**
- **Chats:** "plan my evening", "block two hours for the essay tomorrow".
- **Check-ins:** they keep today and tomorrow sensible, plan Sable's own follow-ups, and block time for things you need to get done when your calendar has room.
- **You:** Plan → **Add**.

Lessons scoped to "plan" (for example "nothing before 9 on weekends") shape all of it.

## What the Plan page shows

- **Day view:** one timeline with a *Now* line.
  - Sable's items and the time blocked for you.
  - **Duty timers:** Morning rundown, Night check and any daily or weekly duty.
  - **Reminders and follow-ups.**
  - **Check-ins and digests:** quiet one-line markers.
  - **Your calendar** (iCal feeds and Google), faded, for context.
- **Week view:** the next 7 days, each as a list; check-ins are folded into a count.
- **Always on:** watchers, webhooks, mail triggers and frequent checks. These have no fixed time, so they're listed rather than placed on the timeline.
- **Acting on items:**
  - Plan items: **Done**, **Move**, **Skip** or **Remove**.
  - Duty timers: **Skip this one**.
  - Reminders: **Remove**.
- **"Something looks wrong? Tell Sable"** sends your words to Main, where Sable fixes the plan with its tools.

Moving, skipping or removing an item Sable planned, and anything you type in that box, are recorded for learning. Sable notices if you always move its morning blocks.

## Code

- `server/src/plan.ts`: plan items, firing (every 20 s), `planLine()` for prompts, and `buildAgenda()` (merges everything for a range).
- `server/src/agent/tools/plan.ts`: `plan_add`, `plan_list`, `plan_update`.
- **Routes:** `GET /agenda`, `POST/PATCH/DELETE /plan`, `POST /plan/feedback`, `POST /schedules/:id/skip`.
- `web/src/views/Plan.tsx`. Plan sits in the sidebar under Home and in the phone tab bar, where Spaces moved to More.
