import type { KitFulfillmentSnapshot } from "@/services/sales-invoices-service";

/**
 * R13 kit sale lines (spec §3 B): a kit owns no stock; the invoice delivered its
 * components (`fulfillmentSnapshot`). Pure, unit-tested in `kit-fulfillment.spec.ts`.
 */
export interface KitComponentRow {
  productId: string;
  /** Stock units of the component per kit. */
  perKit: number;
  /** perKit × kits sold on the line. */
  delivered: number;
  /** Snapshot unit cost, or null when it was withheld / is not shown. */
  unitCost: string | null;
}

function toNumber(value: number | string): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * The components a kit line delivered. `showCost=false` drops every cost (the
 * caller has no cost visibility) even when the payload carried one.
 */
export function kitComponentRows(
  snapshot: KitFulfillmentSnapshot,
  kitQuantity: number,
  showCost: boolean,
): KitComponentRow[] {
  return snapshot.components.map((component) => {
    const perKit = toNumber(component.qtyPerKit);
    const cost = component.unitCost;
    return {
      productId: component.productId,
      perKit,
      delivered: perKit * kitQuantity,
      unitCost:
        showCost && cost !== null && cost !== undefined && cost !== "" ? String(cost) : null,
    };
  });
}

/** Lines that were fulfilled from components (kit lines), in document order. */
export function kitLines<T extends { fulfillmentSnapshot?: KitFulfillmentSnapshot | null }>(
  items: readonly T[],
): (T & { fulfillmentSnapshot: KitFulfillmentSnapshot })[] {
  return items.filter(
    (item): item is T & { fulfillmentSnapshot: KitFulfillmentSnapshot } =>
      !!item.fulfillmentSnapshot && item.fulfillmentSnapshot.components.length > 0,
  );
}
