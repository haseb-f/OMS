"use client";

import { useEffect, useState } from "react";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "@/hooks/use-debounced-value";
import { productsService, type SimilarProductName } from "@/services/products-service";

/** Shorter names are too generic to compare (the API looks at normalized tokens of >= 3 letters). */
export const SIMILAR_NAME_MIN_LENGTH = 3;
/** Typing pauses before the look-up; a little longer than a list search because the hint is advisory. */
export const SIMILAR_NAME_DEBOUNCE_MS = SEARCH_DEBOUNCE_MS + 150;

/** The text worth looking up, or null when the name is too short. */
export function similarNameQuery(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length >= SIMILAR_NAME_MIN_LENGTH ? trimmed : null;
}

/**
 * Non-blocking duplicate hint for the product form: after a typing pause asks
 * `GET /products/similar-names` and returns the look-alikes. Never an error and
 * never a block — a failed or stale request simply shows nothing.
 */
export function useSimilarProductNames({
  name,
  excludeId,
  categoryId,
  enabled = true,
}: {
  name: string;
  /** The product being edited — never its own look-alike. */
  excludeId?: string;
  categoryId?: string;
  enabled?: boolean;
}): SimilarProductName[] {
  const query = enabled ? similarNameQuery(name) : null;
  const debounced = useDebouncedValue(query, SIMILAR_NAME_DEBOUNCE_MS);
  const [result, setResult] = useState<{ key: string; items: SimilarProductName[] }>({
    key: "",
    items: [],
  });
  const key = debounced ? `${debounced}|${excludeId ?? ""}|${categoryId ?? ""}` : "";

  useEffect(() => {
    if (!key || !debounced) return;
    let cancelled = false;
    productsService
      .similarNames({ name: debounced, excludeId, categoryId: categoryId || undefined })
      .then((response) => !cancelled && setResult({ key, items: response.items }))
      .catch(() => !cancelled && setResult({ key, items: [] }));
    return () => {
      cancelled = true;
    };
    // `key` encodes every input of the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Nothing to show for a name that is now too short, or while its look-up is still pending.
  return query && result.key === key ? result.items : [];
}
