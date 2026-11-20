# Look and feel: a polished product, not AI-generated

*Design principles, 2026-11-20. Every UI change from now on follows these.*

## The bar

Sable should feel like a **product a well-funded company built**: calm, fast, confident, with motion that explains things.

**Study these** for how they behave, not to copy their visuals:
- Linear
- Things 3
- Raycast
- Arc
- Stripe's dashboard
- Apple's system apps
- Vercel

**Avoid what makes an interface look AI-generated:**
- purple-to-blue gradients
- glowing blobs
- glass effects everywhere
- emoji headings
- everything bouncing
- identical rounded cards in a grid
- generic illustration packs
- "✨ AI" sparkle icons
- centered hero text over nothing

## Motion rules

1. **Motion means something.** It shows where something came from, where it went, or that something changed. Decoration with no meaning gets cut.
2. **Fast.** 120–220 ms for most transitions. Up to ~400 ms only for big moments like the intro or opening a panel. Springs with little bounce.
3. **One thing moves at a time.** Stagger lists slightly (20–40 ms) and never animate everything at once.
4. **Physical continuity.**
   - A card that opens grows out of where it was.
   - An approval that's accepted slides into the activity it started.
   - A reminder that fires leaves the list.
5. **Respect "reduce motion".** Every animation has a no-motion version.
6. **Never block.** Animations never delay input or content. Text is readable before decoration finishes.

## The intro

Shown when you open the app or site, at most once per session, and **under ~1.2 s** total:

1. Background fades from black (dark theme) or paper (light theme).
2. Sable's mark **draws itself**: a stroke traces the logo shape, then fills.
3. The wordmark slides in beside it with a short letter-spacing settle.
4. The mark shrinks into its place in the sidebar, and the chat fades in behind it, so the intro *becomes* the app instead of being a splash screen in front of it.

It's skippable by tapping, and skipped automatically on fast reloads and with reduce motion. Built with SVG stroke animation and shared-layout transitions (Motion), with no video files.

**Built (Phase 0.3):** `web/src/components/Intro.tsx`.
- Plays once per browser session.
- Any click or key skips it, and it never plays with reduce motion.
- The lockup is drawn at exactly 2× the sidebar header, so it lands at a clean 0.5× scale.
- On phones, where the sidebar is hidden, it fades out instead of flying.
- An inline page background in `index.html` stops a black flash before the styles load.

## Motion tokens

`web/src/lib/motion.ts`:

| Token | Value | Use |
|---|---|---|
| `ease.out` | `[0.2, 0.8, 0.2, 1]` | Most UI |
| `ease.in` | `[0.4, 0, 1, 1]` | Things leaving |
| `dur.quick` | 0.12 s | Hover, press, small state changes |
| `dur.base` | 0.18 s | Pages, cards, panels |
| `dur.slow` | 0.32 s | Bigger moments: opening a panel, the intro |
| `spring` | stiff, almost no bounce | Layout and position changes |
| `stagger` | 0.03 s | Between list items |

- Page changes rise 6 px and fade in.
- Timestamps and counters use the main font with tabular numbers, not monospace. Monospace is for code only.

## Visual signatures

Every kind of event has a signature that's the same everywhere: chat card, notification, Inbox, Live Update. The full table is in [core concepts §4](core-concepts.md#4-notifications-you-understand-before-reading). The rules:

- **Icon plus one color per kind.** Use the theme's tokens, so it reads correctly in dark and light.
- **A small picture beats a sentence:** a map pin, a progress track, a clock face, a snapshot.
- **One tiny motion per signature:** the pin drops, the track fills, the clock hand ticks once.
- **Built:** `web/src/components/Signature.tsx` (approval, reminder, routine, watcher, webhook, agent, task, system). Used in the Inbox and on reminder cards. New kinds get added there first.

## Craft details

- **Type:** one family, two weights. Tight, consistent sizes. Tabular numbers for times and prices.
- **Spacing:** a 4 px grid. Generous whitespace, dense only where you scan (lists, tables).
- **Color:**
  - Neutrals carry the UI. Color is for meaning (status, the kinds of events) and one accent.
  - Every surface tested in dark and light.
  - Spaces get the same tokens injected, so the model can't break theming.
- **States:** every list has empty, loading (skeletons shaped like the content, not spinners), error and success states, all designed.
- **Sound:** subtle and optional (already in Sable). Matches the visual signatures.
- **Performance is design:** content shows in under 100 ms from cache, nothing jumps during load, 60 fps on the phone.

## How we'll check it

- Screenshots in light and dark, at desktop and phone width, for every UI change.
- A short screen recording of each new animation, checked at normal speed and at 25% to catch jank.
- Ask: "would this look out of place in Linear or Things?" If yes, it gets reworked.
