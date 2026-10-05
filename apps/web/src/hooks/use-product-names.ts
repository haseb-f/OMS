"use client";

import { useEffect, useMemo, useState } from "react";
import { productsService } from "@/services/products-service";
import { cachedLookup } from "@/lib/lookup-cache";

export interface ProductNameEntry {
  name: string;
  sku: string;
}

/** The catalog API caps `pageSize` at 200. */
const CHUNK = 200;

/** Distinct, sorted ids — the cache key of a look-up, so the same set is asked once. */
export function productNameLookupKey(ids: readonly (string | null | undefined)[]): string {
  return [...new Set(ids.filter((id): id is string => !!id))].sort().join(",");
}

/**
 * Resolves product ids to names through the existing catalog look-up
 * (`GET /products/catalog?ids=`), for read-only references that arrive as ids
 * (a kit sale's components, a movement's parent kit). Best effort by design:
 * an id the caller may not browse, or a failed request, is simply absent from
 * the map — the screen then shows a neutral placeholder, never an invented name.
 */
export function useProductNames(
  ids: readonly (string | null | undefined)[],
  enabled = true,
): ReadonlyMap<string, ProductNameEntry> {
  const key = productNameLookupKey(ids);
  const [result, setResult] = useState<{ key: string; names: Map<string, ProductNameEntry> }>({
    key: "",
    names: new Map(),
  });

  useEffect(() => {
    if (!enabled || !key) return;
    const all = key.split(",");
    let cancelled = false;
    const chunks: string[][] = [];
    for (let index = 0; index < all.length; index += CHUNK) {
      chunks.push(all.slice(index, index + CHUNK));
    }
    Promise.all(
      chunks.map((chunk) =>
        cachedLookup(`products:names:${chunk.join(",")}`, () =>
          productsService.catalog({ ids: chunk, pageSize: chunk.length }),
        ).catch(() => ({ items: [] })),
      ),
    ).then((pages) => {
      if (cancelled) return;
      const names = new Map<string, ProductNameEntry>();
      for (const page of pages) {
        for (const product of page.items) {
          names.set(product.id, {
            name: product.displayName || product.name,
            sku: product.sku,
          });
        }
      }
      setResult({ key, names });
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return useMemo(
    () => (result.key === key ? result.names : new Map<string, ProductNameEntry>()),
    [result, key],
  );
}
