# Core concepts: how Sable should think about chats, events, Spaces and notifications

*Design notes, 2026-11-20. No code yet. These are the ideas the next phases build on. Research is in [`docs/research/`](../research), and the order is in the [roadmap](../roadmap.md).*

## 1. The main brain and mini chats

- **Main chat ("Sable")**
  - One permanent, pinned conversation where every outside channel lands: the app's home screen, the agent mailbox, calls.
  - Old turns roll into summaries, so it never fills up.
  - It has its own private **journal** (what happened each day, decisions, open loops) on top of the shared [Library](../research/library.md).
- **Mini chats** are topics. They read the Library freely and send a short **digest** up to the main chat when they wrap up ("Trip planned: flights booked Dec 3; hotel still open"). They can *propose* journal entries but can't write them.
- **Automations keep their own chats**, as today, so the main chat isn't buried in reminders. **Exception:** when something matters to the conversation, it's delivered into that chat (see 2).

## 2. Chats that wake themselves

**The problem:** "Tell me when the package arrives" creates a watcher today. When it fires, a **new background chat** wakes up with no idea you've been talking about this package for a week. It can only say "your package arrived".

**The idea:** every event Sable's engines produce can be delivered to **the chat that asked for it**, with that chat's full context. The events include:
- a webhook call
- a watcher firing
- an email arriving
- a sub-agent finishing
- a time arriving
- a Space event

That chat wakes up and continues: "Your package finally arrived. It's the one we tracked since the 12th, and it came two days late, so the refund request we drafted still applies."

**Two delivery modes,** chosen when the automation is set up:

| Mode | Where it runs | Use for |
|---|---|---|
| **Here** (new) | Wakes the chat that set it up, with all its context | Things tied to an ongoing conversation: this package, this application, this project |
| **Background** (today) | Its own automation chat | Recurring or standalone things: morning weather, price drops, the daily email digest |

**Background sub-agents already work this way:** their result comes back into the chat that started them. This generalizes that to every engine.

### "I'll remind you" vs "I'll set a reminder"

You described these as two different things. Here's the difference:

- **"I'll set a reminder":** Sable hands it off. At 10 PM a notification says "Class". The reminder knows nothing else, and that's fine for simple things.
- **"I'll remind you":** Sable **follows up itself**. It schedules a wake-up of *this* chat with a note to itself ("check whether he submitted the essay; he was worried about the citations"). At that time the chat wakes with everything it knows, decides what to say, and may check things first. For example: "You've got 2 hours until it's due. Did the citation fix work?"

**The model decides which to use:**
- If the reminder needs the conversation's context, or is something it should **own**, it follows up itself (a new `follow_up` tool).
- If it's a plain "ping me at 10", it sets a reminder.
- If something is important enough that the main brain should know, it goes to the main chat.

Guidelines go in the prompt; the choice stays the model's.

**Follow-ups are visible.** A small "Sable will follow up Fri 3 PM" chip shows in the chat and the side panel, so you can cancel or move it.

## 3. Spaces: built on Sable's engines, not rebuilding them

A Space is **its own small website**: a UI, plus its own backend, storage and schedules (see [Spaces v3](../research/spaces-v3.md)). It builds on what Sable already runs instead of reinventing it:

| Sable engine | What a Space does with it |
|---|---|
| Webhooks | Receives live data ("baskets" for events) and shows it as it arrives |
| Watchers | Subscribes to their results |
| Connections (APIs, email, calendar) | Reads through Sable; keys never reach the Space |
| Library | Reads its allowed collections; can add to its own |
| Local network | Talks to devices at home (cameras, printers, anything on the LAN) |
| Chats | **Wakes its own chat** (or the main chat) when something worth telling you happens |
| Theming | Sable injects the design tokens, so every Space looks right in **dark and light** without the model thinking about it |

**Security, as you described it:**
- **The local network is allowed.**
- **The open internet is blocked** unless you approve specific sites.
- No Space can widen its own access. Changes to what a Space can reach come to you as a card that lists exactly what changes.

Spaces are **not only cameras.** The examples are dashboards fed by webhooks, image galleries pulled from the Library, trackers with their own database, and anything else a small website can do.

## 4. Notifications you understand before reading

**Principle:** every kind of event has a **visual signature** (icon, color and a small picture or animation) that's the same in the app, in push notifications, in Android Live Updates and in chat cards. You should know *what it is* at a glance.

| Event | Visual |
|---|---|
| Location (arrived, left, sharing) | Small map thumbnail with a pin, place name as the title. Sharing shows a pulsing dot |
| Package / delivery | A progress track (ordered → shipped → out → delivered) with the current step lit. A Live Update chip only while "out for delivery" |
| Approval | What will happen, as a picture: an email icon with "to Sam", or a cart with the total. Approve/Deny buttons |
| Call from Sable | Full call screen (CallStyle) with *why* it's calling as the subtitle: "Someone's at the door" |
| Doorbell / camera | The snapshot itself (BigPicture) |
| Reminder | Clock face showing the time, with the text |
| Sub-agent working | Live Update progress ("Researching: 3 of 5 sources"), mirrored on the Nothing Glyph Bar |
| Email from a watched sender | Sender avatar or initials, subject, one-line summary |
| Something failed | Red outline, what failed, a "Fix" button |

**In the web app:** the same signatures on cards and in the Inbox, with a little motion: a pin dropping, a progress track filling.

## 5. Sub-agents always report what they found (bug, fix first)

**The bug you spotted:**
- When a sub-agent runs out of steps (12 by default), Sable returns only the last thing it *said*. For your researcher, that was "Let me run several targeted searches."
- Everything its tools actually found is dropped.
- The main model then wrote the guide from memory. That's the worst outcome for research.

**Fix:**
1. **A final report, always:** when a sub-agent hits its limit, or its last message is only a plan, it gets one more turn **with tools turned off**: "Write your report now: everything you found, with sources, and what's left undone."
2. **Safety net:** if that's still thin, attach a compact list of what its tools returned (titles, URLs, key lines).
3. **More room, and resumable:** research agents get a higher limit (about 30), and the main agent can **continue** a stopped job with its history intact.
4. **No making things up:** the main agent is told that when research comes back incomplete, it says so or continues the research. It doesn't fill gaps from training.
5. **The card shows it:** "Stopped at step limit · report written · 14 sources", with a Continue button.

## 6. Knowing when to reach you

You don't have fixed quiet hours. Your day changes. So Sable builds an **availability picture** from:
- **Your morning rundown:** "class 6–9:30 tonight, free after".
- **Calendar** busy and free.
- **Location:** at a known place like campus or work, or moving.
- **Phone state:** Android Auto connected or in a vehicle, Do Not Disturb or Driving mode, already on a call.

Each thing to tell you has an urgency, and Sable picks **how and when**:
- **Now and loud:** someone's at the door and you're driving, so it calls you.
- **Now and quiet:** you're in class, so a notification only.
- **Later:** "class ends in 10 minutes; I'll call when you're driving".
- **Digest:** fold it into the evening check-in.

**Waiting is visible:** "Holding 2 things for after class". You can always say "just tell me now".
