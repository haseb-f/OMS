import { ShipmentStatus, ShippingSyncBehavior } from '@prisma/client';

/**
 * Closed display-color tokens for shipping statuses — the same StatusTone
 * vocabulary `StatusBadge` already uses. Arbitrary CSS colors are rejected.
 */
export const SHIPPING_STATUS_COLORS = [
  'neutral',
  'info',
  'warning',
  'success',
  'destructive',
] as const;

export type ShippingStatusColor = (typeof SHIPPING_STATUS_COLORS)[number];

/** `ShippingSyncBehavior` enum values, for DTO/form validation. */
export const SHIPPING_SYNC_BEHAVIORS = [
  ShippingSyncBehavior.UNDER_SYNC,
  ShippingSyncBehavior.FINAL,
] as const;

export const DEFAULT_SHIPPING_STATUS_CODE = 'READY_FOR_SHIPPING';
export const DEFAULT_SHIPPING_STATUS_LABEL = 'جاهز للشحن';

/**
 * Seeded system rows only — written once by migration/`seed.ts`.
 * Runtime List Sheet, import, and UI read `ShippingStatus` from the
 * database. Do not treat this array as a live catalog.
 *
 * `syncBehavior: FINAL` is set ONLY where the Shipping Status Configuration
 * spec explicitly names the status as a FINAL example (تم التسليم) — every
 * other seeded status stays UNDER_SYNC, never guessed from its name.
 */
export const INITIAL_SHIPPING_STATUSES = [
  {
    code: DEFAULT_SHIPPING_STATUS_CODE,
    name: DEFAULT_SHIPPING_STATUS_LABEL,
    color: 'neutral',
    isDefault: true,
    isSystem: true,
    isImportable: false,
    sortOrder: 0,
    syncBehavior: ShippingSyncBehavior.UNDER_SYNC,
  },
  {
    code: 'LABEL_CREATED',
    name: 'تم إنشاء البوليصة',
    color: 'info',
    isDefault: false,
    isSystem: true,
    isImportable: true,
    sortOrder: 1,
    syncBehavior: ShippingSyncBehavior.UNDER_SYNC,
  },
  {
    code: 'SHIPPED',
    name: 'تم الشحن',
    color: 'info',
    isDefault: false,
    isSystem: true,
    isImportable: true,
    sortOrder: 2,
    syncBehavior: ShippingSyncBehavior.UNDER_SYNC,
  },
  {
    code: 'OUT_FOR_DELIVERY',
    name: 'قيد التوصيل',
    color: 'warning',
    isDefault: false,
    isSystem: true,
    isImportable: true,
    sortOrder: 3,
    syncBehavior: ShippingSyncBehavior.UNDER_SYNC,
  },
  {
    code: 'DELIVERED',
    name: 'تم التسليم',
    color: 'success',
    isDefault: false,
    isSystem: true,
    isImportable: true,
    sortOrder: 4,
    syncBehavior: ShippingSyncBehavior.FINAL,
  },
  {
    code: 'DELIVERY_FAILED',
    name: 'فشل التسليم',
    color: 'destructive',
    isDefault: false,
    isSystem: true,
    isImportable: true,
    sortOrder: 5,
    syncBehavior: ShippingSyncBehavior.UNDER_SYNC,
  },
  {
    code: 'NEEDS_RESHIPMENT',
    name: 'بحاجة لإعادة شحن',
    color: 'warning',
    isDefault: false,
    isSystem: true,
    isImportable: true,
    sortOrder: 6,
    syncBehavior: ShippingSyncBehavior.UNDER_SYNC,
  },
] as const;

/** Shipment.status enum values the operational state machine still walks. */
export const OPERATIONAL_SHIPMENT_STATUS_CODES: ShipmentStatus[] = [
  ShipmentStatus.LABEL_CREATED,
  ShipmentStatus.SHIPPED,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.DELIVERY_FAILED,
  ShipmentStatus.NEEDS_RESHIPMENT,
];

export function isShippingStatusColor(
  value: string,
): value is ShippingStatusColor {
  return (SHIPPING_STATUS_COLORS as readonly string[]).includes(value);
}

export function isShippingSyncBehavior(
  value: string,
): value is ShippingSyncBehavior {
  return (SHIPPING_SYNC_BEHAVIORS as readonly string[]).includes(value);
}

export function isOperationalShipmentStatus(
  code: string,
): code is ShipmentStatus {
  return (OPERATIONAL_SHIPMENT_STATUS_CODES as string[]).includes(code);
}

export function matchShippingStatusRecord<
  T extends { code: string; name: string; isImportable?: boolean },
>(records: T[], raw: string | undefined, importableOnly = false): T | null {
  const value = raw?.trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  return (
    records.find((status) => {
      if (importableOnly && status.isImportable === false) return false;
      return status.code === upper || status.name === value;
    }) ?? null
  );
}
