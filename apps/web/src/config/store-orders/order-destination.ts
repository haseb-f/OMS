import type { StoreOrderRow } from "@/services/store-orders-service";

/**
 * Where a company order is delivered (R11). An order created with its own
 * destination keeps it on the order (never copied onto the customer master);
 * an older order, or one delivered to the customer's own address, falls back
 * to the customer record. Agent orders keep the typed customer snapshot and do
 * not use this.
 */
export interface OrderDestination {
  countryId: string;
  city: string;
  address: string;
  /** True when the order carries its own destination (differs from / is independent of the customer record). */
  own: boolean;
}

export function orderDestination(
  order: Pick<StoreOrderRow, "deliveryCountryId" | "deliveryCity" | "deliveryAddress" | "partner">,
): OrderDestination {
  const own = Boolean(order.deliveryCountryId || order.deliveryCity || order.deliveryAddress);
  const partner = order.partner as
    { countryId?: string | null; city?: string | null; address?: string | null } | null | undefined;
  return own
    ? {
        countryId: order.deliveryCountryId ?? "",
        city: order.deliveryCity ?? "",
        address: order.deliveryAddress ?? "",
        own,
      }
    : {
        countryId: partner?.countryId ?? "",
        city: partner?.city ?? "",
        address: partner?.address ?? "",
        own,
      };
}
