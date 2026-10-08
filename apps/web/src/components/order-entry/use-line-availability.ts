"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/services/api-client";
import { buildQueryString } from "@/lib/query-string";
import { productsService } from "@/services/products-service";
import { availabilitySource } from "@/config/orders/line-availability";
import { storeOrderStockApi } from "@/components/store-orders/stock/stock-api";

export interface AvailabilityProduct {
  id: string;
  isInventoryItem: boolean;
  supplyMethod?: string | null;
}

/**
 * Available-to-sell of one product as the inventory API reports it: its own
 * stock (`GET /inventory/stock`, of `owner` — the company or one agent), a kit
 * from its components (`GET /products/:id/kit-availability`), nothing for a
 * service. `null` when it cannot be read (no inventory right, not found) — an
 * unknown figure never raises a warning.
 */
export async function readAvailability(
  product: AvailabilityProduct,
  owner: string,
): Promise<number | null> {
  try {
    switch (availabilitySource(product)) {
      case "KIT":
        return (await productsService.kitAvailability(product.id)).available;
      case "STOCK":
        return (
          await apiClient.get<{ available: number }>(
            `/inventory/stock${buildQueryString({ productId: product.id, owner })}`,
          )
        ).available;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Company lines: available-to-sell in the warehouse the order will reserve in
 * (`POST /store-orders/stock/availability` — stock warehouses only, kits from
 * their components; R15 D15-2). One request for every product not read yet;
 * `null` when it cannot be read (an unknown figure never raises a warning).
 */
async function readCompanyAvailability(
  products: readonly AvailabilityProduct[],
): Promise<Array<readonly [string, number | null]>> {
  try {
    const { lines } = await storeOrderStockApi.availability(
      products.map((product) => ({ productId: product.id, quantity: 1 })),
    );
    const byProduct = new Map(lines.map((line) => [line.productId, line.available]));
    return products.map((product) => [product.id, byProduct.get(product.id) ?? null] as const);
  } catch {
    return products.map((product) => [product.id, null] as const);
  }
}

/**
 * Availability of the products on an order's lines, read once per product per
 * form (`owner`: "COMPANY", or the agent id when staff enter an agent order).
 */
export function useLineAvailability(
  products: readonly AvailabilityProduct[],
  owner: string,
): ReadonlyMap<string, number | null> {
  const [known, setKnown] = useState<ReadonlyMap<string, number | null>>(new Map());
  const missing = useMemo(
    () => products.filter((product) => !known.has(product.id)),
    [products, known],
  );
  const missingKey = missing.map((product) => product.id).join(",");

  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    const read =
      owner === "COMPANY"
        ? readCompanyAvailability(missing)
        : Promise.all(
            missing.map(
              async (product) => [product.id, await readAvailability(product, owner)] as const,
            ),
          );
    void read.then((entries) => {
      if (cancelled) return;
      setKnown((prev) => new Map([...prev, ...entries]));
    });
    return () => {
      cancelled = true;
    };
    // `missingKey` stands for `missing` (same products → same request).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, owner]);

  return known;
}
