# Sable v2: engines that run themselves

*Proposal, 2026-11-21. Goal: Sable runs your life in the background, acts without being asked, gets better on its own, and only reaches you when it's worth it.*

## Why it feels off today

The problems are in how the engines are built, not in the model:

- **Five engines, five sets of rules.** Reminders, routines, watchers, webhooks and follow-ups each decide on their own whether to bother you. Delivery is decided in six different places in the code.
- **"Should I tell you?" is guessed from wording.**
  - The model replies in free text, and code tries to spot "nothing new" with a regex.
  - Any rewording of the same result counts as "new".
  - Watcher runs had no check at all, so they always notified. That bug is fixed now; the guessing remains.
- **Sable only moves when a trigger you set fires.** It never looks around on its own to notice that something needs doing.
- **Nothing is learned.** When a notification annoys you, there's no way to say so, and nothing changes next time.

## The new shape

```
 Signals ──► Duties ──► Attention ──► you
 (what happens)  (what Sable is responsible for)  (the only way to reach you)
                    ▲
       Initiative ──┘   Learning feeds every box
 (Sable prompting itself)
```

### 1. Signals: everything that happens, in one stream

Every input becomes a signal, normalized, deduplicated and stored:
- email and calendar changes
- page changes
- webhooks and finished jobs
- the time of day
- your location, later, from the app

Watchers and webhooks become signal sources. They no longer run their own little agents.

### 2. Duties: what Sable is responsible for

Duties replace routines, watcher prompts and follow-ups. A duty is:
- **A responsibility in plain words.** For example, "keep me on top of school deadlines" or "track my refunds until they land".
- **What wakes it:** signals or times.
- **How free it is:** watch, suggest or act.
- **Its own memory:** what it saw last time and what it already told you.

Every duty run must end with a structured **finish**, not free text:

| Field | Meaning |
|---|---|
| `verdict` | `silent` · `log` · `digest` · `tell` · `urgent` |
| `changed` | what actually changed, or nothing |
| `headline`, `body` | the message, if any |
| `next` | when to look again, if it should change |

**Silent is the default.** "Nothing changed" can no longer turn into a notification, because the code reads the verdict instead of the wording.

### 3. Attention: the only door to you

One gate takes every verdict and decides what reaches you:
- **When:** now, the next digest (morning rundown or evening wrap), or never.
- **Quiet hours and availability:** asleep, in class, driving.
- **Dedupe:** by a stable key, so you're never told the same thing twice.
- **Rate limits and bundling:** three small things become one message.
- **Feedback on every notification:** **Less like this**, **More like this** and **Never about this**. These go straight to Learning.

### 4. Initiative: Sable prompts itself

A heartbeat runs every few hours, and after notable signals. Sable reviews:
- the journal and open loops
- calendar and mail
- goals and recent chats

Then it writes itself an agenda:
- **Do now:** low-risk work within its autonomy, such as preparing a summary, filing receipts, or setting a reminder before an early class.
- **Suggest:** cards in the Inbox with **Do it**, **Not now** or **Never**. For example: "Your refund email says 5–7 days. Want me to check on the 28th?"
- **New duties:** "You've asked about the package three times. Want me to watch for shipping emails?"

It has a daily budget for model calls, so it can't run up costs.

### 5. Learning: Sable gets better on its own

- **After-action notes:** each duty run records what it did and how you reacted (opened, ignored, "less like this").
- **Lessons:**
  - Your feedback becomes rules attached to the duty, such as "don't tell me about prices that didn't drop".
  - Lessons are put into the prompt next time.
- **Weekly self-review:**
  - Sable reads its own notes, failed tool calls and the lessons.
  - It proposes edits to its duties and prompts, shown to you as a before/after to accept.
  - It can also propose new tools or connections, using the self-built connections it already has.

## Guardrails (unchanged and extended)

- **Approvals:** sending, buying and deleting still ask unless you said otherwise for that duty.
- **Freeze, taint and the redactor** still apply.
- **Autonomy is per area.** Example: mail = act, money = suggest, people = watch.
- **Anything Sable did on its own is listed under "Done for you"** with a "Why?" link to the duty and the signal behind it.
- **Limits:** a budget, plus a hard cap on runs per hour.

## The new front

| Today | Becomes |
|---|---|
| Home (sections) | **Today:** agenda, "Done for you", suggestions, what's next |
| Routines, Watchers, Webhooks | **Duties** (one page; sources and schedules live inside each duty) |
| Inbox | Approvals and suggestions, with feedback |
| Notifications | Fewer, bundled, each with Less/More/Never |

## Built so far

**Phase 1, the attention gate (2026-11-21):**
- `server/src/attention.ts` judges everything that goes through `notify()`. Verdicts are silent, log, digest, tell or urgent, adjusted by your feedback, dedupe (same key or same words within 24 h), quiet hours (in your time zone) and the hourly limit.
- Background runs end with the `finish` tool and give a verdict. Without one, a routine set to "always" tells; anything else is kept quiet unless it plainly has news.
- The digest goes out when quiet hours end and at 12:30 and 18:30, as one notification.
- Inbox rows show how each item was handled, with Less / More / Never. Pushes have **Less like this** and **Never** buttons.
- Settings → Notifications → *When Sable reaches you* has quiet hours, digest times, the hourly limit, and what you've tuned.
- Approvals and reminders you set always come through.

**Phase 2, duties and signals (2026-11-21):**
- `server/src/duties.ts`:
  - A duty is a title, a purpose, instructions, its autonomy (act, suggest or watch), notify (when_new or always), memory and a status (active, paused or done).
  - `runDuty` wakes a duty with a signal in its own chat. The run sees its purpose, its memory and your Less/More/Never feedback, and ends with `finish` (verdict plus `remember`, which updates the memory).
- **What wakes a duty:**
  - routines (its timers)
  - watchers
  - webhooks
  - mail from a sender or about a subject, on Sable mail or a watched mailbox
- **Signals:** every timer, watcher trigger, webhook receipt and new mail is recorded, and the last 2,000 are kept.
- **Adoption:** existing routines, watchers with instructions and webhooks with instructions became duties automatically, keeping their chats (the Morning rundown still lands in Main). Plain alerts and "wake this chat" watchers stay as they were.
- **Autonomy:**
  - *act* pre-approves a duty's steps except send, buy, delete and checkout.
  - *suggest* asks for everything.
  - *watch* only reports.
  - Only you can raise a duty to *act* (approving `duty_create`, or the Duties page).
- **Tools:** `duty_create` (needs your OK), `duty_list`, `duty_update`, `duty_run`, `duty_delete`. Active duties are listed in every prompt.
- **The Duties page:** each duty with what wakes it, Acts/Suggests/Watches, its memory (editable), run now, pause, and a "Lately" list of signals.
- **Follow-ups** stay as they are (they continue one chat). They're the conversational cousin of a duty.

## Phases

1. **Attention + finish.** One gate, structured verdicts, quiet hours, dedupe, digest, and feedback buttons. *Fixes the noise first.*
2. **Duties.** Merge routines, watcher prompts and follow-ups, with an automatic migration. Signals are stored.
3. **Initiative.** Heartbeat, agenda, suggestions in the Inbox, and a budget.
4. **Learning.** Lessons from feedback, and the weekly self-review with proposed edits.
5. **The new front.** Today, Duties, the new Inbox.

Each phase ships on its own and keeps everything else working.
