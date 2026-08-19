import { ShipmentStatus } from '@prisma/client';

/**
 * Canonical shipping-status vocabulary for OMS.
 *
 * `Shipment.status` remains a closed Prisma enum (workflow state machine).
 * This catalog is the ONE place Arabic display labels, List Sheet values,
 * import validation, and the Shipping Statuses master-data page read from.
 * Do not add a second hardcoded list.
 */
export const SHIPPING_STATUS_CATALOG = [
  {
    code: 'READY_FOR_SHIPPING',
    label: 'جاهز للشحن',
    /** UI / List Sheet only — not a persisted ShipmentStatus value. */
    importable: false,
    isDefault: true,
    isSystem: true,
  },
  {
    code: 'LABEL_CREATED',
    label: 'تم إنشاء البوليصة',
    importable: true,
    isDefault: false,
    isSystem: true,
  },
  {
    code: 'SHIPPED',
    label: 'تم الشحن',
    importable: true,
    isDefault: false,
    isSystem: true,
  },
  {
    code: 'OUT_FOR_DELIVERY',
    label: 'قيد التوصيل',
    importable: true,
    isDefault: false,
    isSystem: true,
  },
  {
    code: 'DELIVERED',
    label: 'تم التسليم',
    importable: true,
    isDefault: false,
    isSystem: true,
  },
  {
    code: 'DELIVERY_FAILED',
    label: 'فشل التسليم',
    importable: true,
    isDefault: false,
    isSystem: true,
  },
  {
    code: 'NEEDS_RESHIPMENT',
    label: 'بحاجة لإعادة شحن',
    importable: true,
    isDefault: false,
    isSystem: true,
  },
] as const;

export const DEFAULT_SHIPPING_STATUS_CODE = SHIPPING_STATUS_CATALOG[0].code;
export const DEFAULT_SHIPPING_STATUS_LABEL = SHIPPING_STATUS_CATALOG[0].label;

export type ShippingStatusCode =
  (typeof SHIPPING_STATUS_CATALOG)[number]['code'];

export const SHIPPING_STATUS_SHEET_LABELS: Record<string, string> =
  Object.fromEntries(
    SHIPPING_STATUS_CATALOG.map((status) => [status.code, status.label]),
  );

export const IMPORTABLE_SHIPPING_STATUS_CODES: ShipmentStatus[] =
  SHIPPING_STATUS_CATALOG.filter((status) => status.importable).map(
    (status) => status.code as ShipmentStatus,
  );

export const IMPORTABLE_SHIPPING_STATUS_LABELS = SHIPPING_STATUS_CATALOG.filter(
  (status) => status.importable,
).map((status) => status.label);

/**
 * Accepts an enum code (`SHIPPED`) or the canonical Arabic label (`تم الشحن`).
 * Returns the enum code, or null when the value is unknown / not importable.
 */
export function resolveImportableShippingStatus(
  raw: string | undefined,
): ShipmentStatus | null {
  const value = raw?.trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  for (const status of SHIPPING_STATUS_CATALOG) {
    if (!status.importable) continue;
    if (status.code === upper || status.label === value) {
      return status.code;
    }
  }
  return null;
}
