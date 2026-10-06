import { normalizeArabicSearch } from '../common/text/arabic-search';

export type ProductNameMatch = 'EXACT' | 'CONTAINS' | 'SIMILAR';

/** Shortest typed name for which "contains" is meaningful — shorter fragments match half the catalog. */
export const SIMILAR_NAME_MIN_CONTAINS_LENGTH = 4;
/** Fewer than this many characters in a token are never used to look candidates up. */
export const SIMILAR_NAME_MIN_TOKEN_LENGTH = 3;
const TOKEN_JACCARD_THRESHOLD = 0.6;
const MATCH_RANK: Record<ProductNameMatch, number> = {
  EXACT: 0,
  CONTAINS: 1,
  SIMILAR: 2,
};

/** The shared Arabic normalization, plus punctuation folded to spaces — "Cable-USB" and "cable usb" compare equal. */
export function normalizeProductName(value: string): string {
  return normalizeArabicSearch(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function productNameTokens(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * How `candidate` relates to the typed `needle` (both already normalized):
 * EXACT (same text), CONTAINS (one holds the other, from 4 characters),
 * SIMILAR (mostly the same words, or a near-typo of the whole name), or null.
 * Advisory only — a match never blocks saving.
 */
export function classifyNameMatch(
  needle: string,
  candidate: string,
): ProductNameMatch | null {
  if (!needle || !candidate) return null;
  if (needle === candidate) return 'EXACT';
  if (
    (needle.length >= SIMILAR_NAME_MIN_CONTAINS_LENGTH &&
      candidate.includes(needle)) ||
    (candidate.length >= SIMILAR_NAME_MIN_CONTAINS_LENGTH &&
      needle.includes(candidate))
  ) {
    return 'CONTAINS';
  }
  const a = new Set(productNameTokens(needle));
  const b = new Set(productNameTokens(candidate));
  const shared = [...a].filter((token) => b.has(token)).length;
  const union = a.size + b.size - shared;
  if (union > 0 && shared / union >= TOKEN_JACCARD_THRESHOLD) return 'SIMILAR';
  const longest = Math.max(needle.length, candidate.length);
  if (
    longest >= 5 &&
    levenshtein(needle, candidate) <= Math.max(1, Math.floor(longest * 0.2))
  ) {
    return 'SIMILAR';
  }
  return null;
}

/** The best match of a product across its name columns (name / displayName / internalName / nameEn). */
export function bestNameMatch(
  needle: string,
  names: Array<string | null | undefined>,
): ProductNameMatch | null {
  let best: ProductNameMatch | null = null;
  for (const name of names) {
    if (!name) continue;
    const match = classifyNameMatch(needle, normalizeProductName(name));
    if (match && (best === null || MATCH_RANK[match] < MATCH_RANK[best])) {
      best = match;
    }
  }
  return best;
}

export function compareNameMatches(
  a: { match: ProductNameMatch; sameCategory: boolean },
  b: { match: ProductNameMatch; sameCategory: boolean },
): number {
  return (
    MATCH_RANK[a.match] - MATCH_RANK[b.match] ||
    Number(b.sameCategory) - Number(a.sameCategory)
  );
}
