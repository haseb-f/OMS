"use client";

import { useEffect, useMemo, useState } from "react";
import { productsService } from "@/services/products-service";
import { cachedLookup } from "@/lib/lookup-cache";
import { productNameLookupKey } from "./use-product-names";

/** At most this many products' recipe lists are read for one screen (one request each). */
export const RECIPE_VERSION_LOOKUP_LIMIT = 30;

/**
 * recipeId → version for the recipes of the given kit / assembled products,
 * read through the existing recipe list (`GET /products/:id/recipes`, needs
 * `products.view` — pass `enabled=false` otherwise). Best effort: a product
 * whose recipes cannot be read contributes nothing, and the screen then shows
 * no version rather than a guessed one.
 */
export function useRecipeVersions(
  productIds: readonly (string | null | undefined)[],
  enabled = true,
): ReadonlyMap<string, number> {
  const key = productNameLookupKey(productIds);
  const [result, setResult] = useState<{ key: string; versions: Map<string, number> }>({
    key: "",
    versions: new Map(),
  });

  useEffect(() => {
    if (!enabled || !key) return;
    const ids = key.split(",").slice(0, RECIPE_VERSION_LOOKUP_LIMIT);
    let cancelled = false;
    Promise.all(
      ids.map((id) =>
        cachedLookup(`products:recipes:${id}`, () => productsService.recipes.list(id)).catch(
          () => [],
        ),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const versions = new Map<string, number>();
      for (const recipes of lists) {
        for (const recipe of recipes) versions.set(recipe.id, recipe.version);
      }
      setResult({ key, versions });
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return useMemo(
    () => (result.key === key ? result.versions : new Map<string, number>()),
    [result, key],
  );
}
