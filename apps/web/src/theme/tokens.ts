/**
 * TypeScript mirror of the non-color design tokens in `theme/tokens.css`,
 * for contexts that need real numbers (Motion transitions) rather than a
 * CSS variable string. Keep both files in sync when either changes.
 */

/** Motion's `transition.duration` is in seconds, unlike the CSS ms value.
 * One animation language only (ADR-0019): 170ms, ease-out. */
export const duration = {
  base: 0.17,
} as const;

export const easing = {
  standard: [0, 0, 0.2, 1] as const,
};
