/**
 * Status tone vocabulary + the one mapper from an admin-configured color key
 * (workflow statuses, shipping-status catalog, customer classifications) to
 * a semantic tone. Kept as plain functions (not components) so list cells,
 * exports and tests can all reuse them.
 */

export const STATUS_TONES = ["success", "warning", "destructive", "info", "neutral"] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

export interface ResolvedStatusColor {
  tone: StatusTone;
  /**
   * Only set when the key names a color with no semantic tone (e.g. purple or
   * an arbitrary hex): the badge stays neutral — readable in both themes —
   * and this color is used for its small dot only, never as a background.
   */
  dotColor?: string;
}

const NAMED_TONES: Record<string, StatusTone> = {
  // Semantic keys (what the Master Data color pickers store today).
  success: "success",
  warning: "warning",
  destructive: "destructive",
  info: "info",
  neutral: "neutral",
  // Common aliases from older data / imports.
  danger: "destructive",
  error: "destructive",
  red: "destructive",
  rose: "destructive",
  orange: "warning",
  amber: "warning",
  yellow: "warning",
  green: "success",
  emerald: "success",
  lime: "success",
  teal: "success",
  blue: "info",
  sky: "info",
  cyan: "info",
  indigo: "info",
  primary: "info",
  gray: "neutral",
  grey: "neutral",
  slate: "neutral",
  zinc: "neutral",
  muted: "neutral",
  default: "neutral",
  secondary: "neutral",
};

/** Named colors that have no semantic tone — neutral badge + colored dot. */
const DOT_ONLY_NAMES = new Set(["purple", "violet", "fuchsia", "pink", "brown"]);

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  let value = hex.replace("#", "");
  if (value.length === 3 || value.length === 4) {
    value = value
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  } else if (value.length === 8) {
    value = value.slice(0, 6);
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

/**
 * Maps any stored color key to the closest semantic tone. Unknown / empty
 * keys are neutral. A hex is bucketed by hue (red → destructive, orange and
 * yellow → warning, green → success, blue → info); low-saturation hexes are
 * neutral; hues with no status meaning (purple, pink) stay neutral with the
 * original color on the dot only.
 */
export function resolveStatusColor(colorKey: string | null | undefined): ResolvedStatusColor {
  const key = colorKey?.trim().toLowerCase();
  if (!key) return { tone: "neutral" };
  const named = NAMED_TONES[key];
  if (named) return { tone: named };
  if (DOT_ONLY_NAMES.has(key)) return { tone: "neutral", dotColor: key };

  if (key.startsWith("#")) {
    const hsl = hexToHsl(key);
    if (!hsl) return { tone: "neutral" };
    if (hsl.s < 0.2 || hsl.l < 0.1 || hsl.l > 0.95) return { tone: "neutral" };
    const { h } = hsl;
    if (h < 15 || h >= 345) return { tone: "destructive" };
    if (h < 65) return { tone: "warning" };
    if (h < 170) return { tone: "success" };
    if (h < 255) return { tone: "info" };
    return { tone: "neutral", dotColor: key };
  }
  return { tone: "neutral" };
}

/** Tone-only shorthand of `resolveStatusColor` for callers that just need the tone. */
export function toneFromColorKey(colorKey: string | null | undefined): StatusTone {
  return resolveStatusColor(colorKey).tone;
}

/** Solid dot fill per tone (the `dot` badge variant and color pickers). */
export const STATUS_TONE_DOT_CLASS: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
};
