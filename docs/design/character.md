# Sable's presence

Sable has a small outline mark instead of a detailed character. It appears in the sidebar, beside Sable's replies, on Home, in empty states, on the freeze banner and in the intro. Its mood always comes from what Sable is really doing, so you can read it at a glance.

## The mark

A head drawn as **one outline** in the text color: two round ears and a round face. The **eyes are the only color** (amber; frost blue when frozen) and carry every expression. There are no fills, shading or detail, on purpose: a simple line drawing reads as designed, while a detailed illustration reads as generated. The line stays about 1.5px at sidebar size and about 3px on Home.

The rest of the UI follows the same rule:
- Cards, the sidebar and panels sit on the page background and are drawn with thin lines.
- Shadows appear only on things that float: menus, dialogs and toasts.

## Moods

| Mood | When | What you see |
|---|---|---|
| Around | Nothing running | Slow breath, the odd blink |
| Thinking | A run started, nothing written yet | Eyes look up and aside |
| Working | Writing or running tools | Eyes narrow, small bob |
| Needs you | An approval is waiting | Ears up, head tilts, eyes wide |
| Done | A run just finished (about 3 s), or you tap it on Home | ^ ^ eyes, a hop |
| Resting | 1 to 6 am with nothing to do | Eyes closed, head lowered |
| Frozen | Freeze is on | Still, frost-blue eyes |

Priority when several apply: frozen, needs you, thinking or working, done, resting, around. Inside a chat, the avatar on Sable's turn uses that chat's state only.

## Code

- `web/src/components/SableCharacter.tsx`: the mark and its moods.
- `web/src/lib/mood.ts`: `useSableMood(conversationId?)`.
- `web/src/components/Den.tsx`: Home's top. Sable says the one thing that matters right now (approvals, what's running, time of day). The words arrive one at a time, set in Bricolage Grotesque, Sable's "voice" font.
- `web/src/views/MeetSable.tsx`: every mood, opened by clicking Sable's name in the sidebar.

## Rules

- **Motion:** only transforms, opacity and stroke properties are animated, so it behaves in Safari. With reduce motion it holds still.
- **Colors:** all come from the `--sable-*` tokens in `index.css`.
- **Palette:** dark brown-black, amber for Sable's light and "needs you", pine green for success, snow in light theme.
