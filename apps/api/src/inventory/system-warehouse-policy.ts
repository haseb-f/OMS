import { BadRequestException } from '@nestjs/common';
import { WarehouseRole } from '@prisma/client';

/**
 * What a stock writer does at a warehouse:
 *  - RECEIVE          goods enter it (opening balance, positive adjustment, transfer
 *                     destination, purchase receipt, production output, a count that finds more);
 *  - WRITE_OFF        goods leave it without being sold (negative adjustment, damage / expiry,
 *                     transfer source, purchase return, a count that finds less);
 *  - ISSUE            goods are sold / held for a sale / consumed (sales delivery, reservation,
 *                     production consumption);
 *  - INSPECTED_RETURN goods come back from a customer after inspection (sales return).
 */
export type WarehouseUse =
  'RECEIVE' | 'WRITE_OFF' | 'ISSUE' | 'INSPECTED_RETURN';

/**
 * R15 (review M3, D15-4) — the system warehouses belong to the store-order
 * stock lifecycle:
 *  - goods in transit (TRANSIT): only the lifecycle moves them — dispatch /
 *    receive back (`postDocumentTransfer`) and the delivery out of transit
 *    (`postSalesDelivery` with `systemWarehouse`). Every manual document is
 *    refused, so the warehouse always reconciles to the parcels with carriers;
 *  - damaged goods (DAMAGED): goods enter it only through inspection (receive
 *    back, sales return); a manual document may only take goods OUT of it —
 *    write-off / damage adjustment, transfer back to a stock warehouse,
 *    purchase return, a count that finds less — never sell, reserve or
 *    consume from it, and never put goods into it.
 * Stock warehouses accept everything. Pure, so the rule is unit-tested.
 */
export function systemWarehouseAllows(
  role: WarehouseRole,
  use: WarehouseUse,
  system = false,
): boolean {
  switch (role) {
    case WarehouseRole.TRANSIT:
      return system && use === 'ISSUE';
    case WarehouseRole.DAMAGED:
      return use === 'WRITE_OFF' || use === 'INSPECTED_RETURN';
    default:
      return true;
  }
}

/** 400 `SYSTEM_WAREHOUSE_REFUSED` (bilingual) when the writer may not use the warehouse. */
export function assertWarehouseUse(
  warehouse: { code: string; role: WarehouseRole },
  use: WarehouseUse,
  system = false,
): void {
  if (systemWarehouseAllows(warehouse.role, use, system)) return;
  const transit = warehouse.role === WarehouseRole.TRANSIT;
  const messageAr = transit
    ? `${warehouse.code} مستودع البضاعة في الطريق — تحرّكه دورة الطلب فقط (الشحن / التسليم / استلام المرتجع) ولا يُستخدم في المستندات اليدوية`
    : `${warehouse.code} مستودع البضاعة التالفة — تدخله البضاعة بعد الفحص فقط، والمستندات اليدوية تُخرج منه فقط (إعدام / تحويل إلى مستودع مخزون / مرتجع مشتريات)`;
  const messageEn = transit
    ? `${warehouse.code} is the goods-in-transit warehouse — only the store-order lifecycle (dispatch, delivery, receive back) moves it; manual documents cannot use it.`
    : `${warehouse.code} is the damaged-goods warehouse — goods enter it only after inspection (receive back, sales return); manual documents may only take goods out of it (write-off, transfer to a stock warehouse, purchase return).`;
  throw new BadRequestException({
    code: 'SYSTEM_WAREHOUSE_REFUSED',
    message: `${messageAr} — ${messageEn}`,
    messageAr,
    messageEn,
    warehouseCode: warehouse.code,
  });
}
