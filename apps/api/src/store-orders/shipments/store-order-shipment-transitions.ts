import { ShipmentStatus } from '@prisma/client';

/**
 * Named Store Order shipping operations — not the Google Sheets import
 * escape hatch (`setStatus`). Payment matching remains a separate order-level
 * gate (`StoreOrderShippingStage`); this map only constrains Shipment.status.
 *
 * Closed Prisma enum is unchanged. Conceptual mapping:
 *   جاهز للشحن          → order.shippingStage READY_FOR_SHIPPING (no shipment yet)
 *   تم الشحن            → SHIPPED
 *   تم التسليم          → DELIVERED
 *   فشل التسليم + إعادة → DELIVERY_FAILED → NEEDS_RESHIPMENT
 */
const ALLOWED: Record<string, ReadonlySet<ShipmentStatus | null>> = {
  [ShipmentStatus.LABEL_CREATED]: new Set([null]),
  [ShipmentStatus.SHIPPED]: new Set([null, ShipmentStatus.LABEL_CREATED]),
  [ShipmentStatus.OUT_FOR_DELIVERY]: new Set([ShipmentStatus.SHIPPED]),
  [ShipmentStatus.DELIVERED]: new Set([
    ShipmentStatus.SHIPPED,
    ShipmentStatus.OUT_FOR_DELIVERY,
  ]),
  [ShipmentStatus.DELIVERY_FAILED]: new Set([
    ShipmentStatus.SHIPPED,
    ShipmentStatus.OUT_FOR_DELIVERY,
  ]),
  [ShipmentStatus.NEEDS_RESHIPMENT]: new Set([ShipmentStatus.DELIVERY_FAILED]),
};

export function canTransitionShipmentStatus(
  from: ShipmentStatus | null | undefined,
  to: ShipmentStatus,
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED[to];
  if (!allowed) return false;
  return allowed.has(from ?? null);
}

export function shipmentTransitionError(
  from: ShipmentStatus | null | undefined,
  to: ShipmentStatus,
): string {
  return `لا يمكن تغيير حالة الشحن من ${from ?? 'بدون شحنة'} إلى ${to}.`;
}
