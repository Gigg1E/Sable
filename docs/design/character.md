# Sable's presence

Sable has a small, symbolic mark instead of a detailed character. It appears in the sidebar, beside Sable's replies, on Home, in empty states, on the freeze banner and in the intro. Its mood always comes from what Sable is really doing, so you can read it at a glance.

## Two looks

You can switch between them on **Meet Sable**: click Sable's name in the sidebar. The choice is saved on each device.

| Look | What it is |
|---|---|
| **Orb** (default) | A dark sphere with an amber light inside and a ring around it. No face. |
| **Head** | A head silhouette: two round ears and two glowing amber eyes, nothing else. |

Both use one drawing at every size, from 22px in the sidebar to 120px on Home.

## Moods

| Mood | When | Orb | Head |
|---|---|---|---|
| Around | Nothing running | Slow breath, quiet ring | Slow breath, the odd blink |
| Thinking | A run started, nothing written yet | Dotted ring, a spark circles it | Eyes look up |
| Working | Writing or running tools | Ring spins in arcs | Eyes narrow, small bob |
| Needs you | An approval is waiting | Ripples leave the ring | Ears up, head tilt, eyes wide |
| Done | A run just finished (about 3 s), or you tap it on Home | Bounce | ^ ^ eyes, hop |
| Resting | 1 to 6 am with nothing to do | Dimmed, slower breath | Eyes closed, head lowered |
| Frozen | Freeze is on | Still, frost blue | Still, frost-blue eyes |

Priority when several apply: frozen, needs you, thinking or working, done, resting, around. Inside a chat, the avatar on Sable's turn uses that chat's state only.

## Code

- `web/src/components/SableCharacter.tsx`: both looks, plus `useLook` / `setLook`.
- `web/src/lib/mood.ts`: `useSableMood(conversationId?)`.
- `web/src/components/Den.tsx`: Home's top. Sable says the one thing that matters right now (approvals, what's running, time of day). The words arrive one at a time, set in Bricolage Grotesque, Sable's "voice" font.
- `web/src/views/MeetSable.tsx`: the look picker and every mood.

## Rules

- **Motion:** only transforms, opacity and stroke properties are animated, so it behaves in Safari. With reduce motion it holds still.
- **Colors:** all come from the `--sable-*` tokens in `index.css`.
- **Palette:** dark brown-black, amber for Sable's light and "needs you", pine green for success, snow in light theme.
