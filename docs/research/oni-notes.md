# Notes on Oni, and what Sable can learn from it

*Read 2026-11-20 from the Oni repo (read-only; nothing in Oni was changed).*

## What Oni is, and how it relates to Sable

Oni is a **server caretaker**: a Python daemon (about 3,700 lines, no runtime dependencies) that lives on a server and treats the machine as its body.

- **Senses:** it watches disk, memory, load, file integrity, logs, services and an inbox folder.
- **Limbs:** it acts through shell, files, web, services, scheduler, memory and sub-agents.
- **Voice:** it talks to its owner over Telegram, ntfy, email, webhooks or a local `oni` command.
- **No exposure:** there's no UI, and it opens no network ports.
- **Its own model:** a small local model **fine-tuned on Oni's own text protocol**.

**Oni and Sable don't talk to each other.**
- Oni repairs and maintains servers, and will watch several of them.
- Its scheduling, memory and sub-agents exist for maintenance work, not personal assistance.
- Sable runs your life.
- There's no bridge between them, and none is planned.

## How Oni works (the parts worth understanding)

| Part | How it works | File |
|---|---|---|
| **Event queue** | Messages, sense alerts, scheduled jobs and inbox files are all `Event`s with a priority (urgent 0 … low 8). One "conscious loop" handles them one at a time, most urgent first | `hub.py` |
| **Reflexes** | `/freeze /thaw /status /mode /jobs /audit /good /bad` are handled **instantly without the model**. Approvals are just `/yes a3f9` | `hub.py` |
| **Text protocol** | The model writes `<think>`, `<act>{json}</act>`, `<say>` and `<done/>`. The engine stops at `</act>`, the runtime answers with `<obs>`. This works on any engine without native tool calling | `protocol.py`, `mind.py` |
| **Fine-tuned mind** | About 1,600 synthetic episodes across 24 scenarios (injection resistance, staying quiet when nothing's wrong, accepting denials, recovering from errors), LoRA-tuned onto a 3–17B model | `model/train/` |
| **Self-improvement** | Rate an episode `/good` and it becomes training data for the next fine-tune | `cli.py`, `memory.py` |
| **Risk tiers per call** | Each tool rates the *specific* call: read → write (inside its own zones) → exec → admin → forbidden. Paths are resolved through symlinks before checking | `immune/policy.py` |
| **Taint tracking** | Once untrusted text (web, logs, email, files, sense events) enters an episode, anything beyond observation needs your `/yes`. Sub-agents inherit taint and pass it back up | `mind.py`, `policy.py` |
| **Modes and freeze** | `autonomous / supervised / observer`, and `/freeze` makes it observe-only instantly, denying anything pending | `policy.py`, `hub.py` |
| **Silence by default** | Self-triggered episodes (alerts, timers) only speak when the owner should know. Progress chatter is dropped | `mind.py` |
| **Audit chain** | Every request, decision and result goes to an append-only, HMAC-chained log, mirrored to the systemd journal. `/audit` verifies it | `immune/audit.py` |
| **Redaction** | Every observation and every outgoing message passes a redactor: known secret values plus patterns for API keys, tokens and private keys | `immune/redact.py` |
| **Hardening** | It runs as an unprivileged user with a short sudoers list. Secrets live in a non-dumpable process, and children get a scrubbed environment | `deploy/`, `hub.py` |
| **Reversible** | Deletes go to trash; edits keep the previous version | `limbs/fs.py` |
| **Sense dedupe** | Each alert key has a cooldown, so a flapping signal doesn't spam the mind | `hub.py` |

## Ideas worth bringing into Sable

These are ideas, not a merge. Each is listed in the roadmap where it fits.

1. **Taint per run.**
   - Sable already wraps untrusted content in tags. Oni goes further: once a run has read untrusted content, every action beyond reading needs your OK.
   - Sable should do the same per run, combined with its per-tool policies.
   - This is the main defense for the Library, email and Spaces.
2. **Risk judged per call, not per tool.** For example, `run_command` with `ls` vs `rm`, or a file write inside the chat folder vs outside it.
3. **Freeze.** One button (in the app, in a notification, or the word "freeze" from any channel) makes Sable observe-only instantly and denies everything pending, without the model involved.
4. **Reflex commands** that skip the model. `/status`, `/freeze` and `/approve` are fast and still work when the model is down.
5. **A tamper-evident activity log.** Sable has an Activity page; chaining it with an HMAC makes it trustworthy as a record of what Sable did.
6. **Redaction on the way out.** A redactor on everything Sable sends to channels and cloud models. It catches secrets the model accidentally echoes. It also fits the **private/public Library split**: private items never leave unredacted.
7. **Good/bad ratings → learning.** Thumbs up/down on a turn feeds the Library's procedures now, and fine-tuning data later on the AI server.
8. **A text protocol for small local models.** If a small local model struggles with native tool calling, Oni's tagged protocol (plus a light fine-tune) makes a 7B model behave far better. Worth testing when the AI server arrives.
9. **Silence by default for background work.** Sable's "only when new" rule is the same idea; keep applying it everywhere.

## Something Oni has in common with Sable's bug

Oni's sub-agents return only what they *said*. If a sub-agent never says anything, the report is "(the sub-agent finished without a report)", and its findings are lost. That's the same issue as Sable's sub-agent bug ([core concepts §5](../design/core-concepts.md#5-sub-agents-always-report-what-they-found-bug-fix-first)). The same fix applies: a forced final report with tools off. Flagged only; Oni wasn't changed.
