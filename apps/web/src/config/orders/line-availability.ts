/**
 * R15 W1 (spec 1.10) — available-to-sell on order lines. The figures come from
 * the APIs as they are (the stock lifecycle owns what "available" means: STOCK
 * warehouses only, on-hand − reserved); this only compares them with what the
 * lines ask for, so the user is warned before saving that the order will wait
 * for stock. Never blocks: a short order is saved as awaiting stock.
 */

/** How a product's availability is read: own stock, a kit's components, or not at all (service / digital). */
export type AvailabilitySource = "STOCK" | "KIT" | "NONE";

export function availabilitySource(product: {
  isInventoryItem: boolean;
  supplyMethod?: string | null;
}): AvailabilitySource {
  if (product.supplyMethod === "KIT") return "KIT";
  return product.isInventoryItem ? "STOCK" : "NONE";
}

export interface AvailabilityShortfall {
  productId: string;
  requested: number;
  available: number;
}

/**
 * Products whose requested quantity (summed over every line of the product)
 * exceeds the known availability. A product whose availability is unknown
 * (`null` / missing — no stock right, not loaded yet, not a stock item) is
 * never reported.
 */
export function availabilityShortfalls(
  lines: ReadonlyArray<{ productId: string | null | undefined; quantity: number }>,
  available: ReadonlyMap<string, number | null>,
): AvailabilityShortfall[] {
  const requested = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId || !(line.quantity > 0)) continue;
    requested.set(line.productId, (requested.get(line.productId) ?? 0) + line.quantity);
  }
  const shortfalls: AvailabilityShortfall[] = [];
  for (const [productId, quantity] of requested) {
    const known = available.get(productId);
    if (known === null || known === undefined) continue;
    if (quantity > known) shortfalls.push({ productId, requested: quantity, available: known });
  }
  return shortfalls;
}
