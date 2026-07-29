/**
 * TypeScript mirror of the non-color design tokens in `theme/tokens.css`,
 * for contexts that need real numbers (Motion transitions, inline styles) or
 * JS conditionals (`useMediaQuery`) rather than a CSS variable string. Keep
 * both files in sync when either changes.
 */

export const zIndex = {
  sidebar: 30,
  topbar: 40,
  commandPalette: 70,
} as const;

/** Motion's `transition.duration` is in seconds, unlike the CSS ms values. */
export const duration = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const;

export const easing = {
  standard: [0.4, 0, 0.2, 1] as const,
  emphasized: [0.2, 0, 0, 1] as const,
};

/**
 * Mirrors Tailwind CSS v4's default breakpoint scale (px), used to keep
 * `useMediaQuery`-driven JS behavior (e.g. sidebar collapse) aligned with
 * the `sm:`/`md:`/`lg:` utilities used in markup.
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

/** Semantic device categories used by the responsive shell. */
export const devices = {
  mobile: `(max-width: ${breakpoints.md - 1}px)`,
  tablet: `(min-width: ${breakpoints.md}px) and (max-width: ${breakpoints.lg - 1}px)`,
  desktop: `(min-width: ${breakpoints.lg}px)`,
} as const;
