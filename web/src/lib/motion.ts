/**
 * Motion tokens (docs/design/look-and-feel.md). Fast, meaningful, one thing at a time.
 * Use these instead of ad-hoc numbers so the whole app moves the same way.
 */
export const ease = {
  /** Most UI: quick start, gentle settle. */
  out: [0.2, 0.8, 0.2, 1] as const,
  /** Things leaving. */
  in: [0.4, 0, 1, 1] as const,
};

export const dur = {
  /** Hover, press, small state changes. */
  quick: 0.12,
  /** Most transitions: pages, cards, panels. */
  base: 0.18,
  /** Bigger moments: opening a panel, the intro. */
  slow: 0.32,
};

/** Spring with almost no bounce, for layout and position changes. */
export const spring = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 } as const;

/** Stagger between list items. */
export const stagger = 0.03;
