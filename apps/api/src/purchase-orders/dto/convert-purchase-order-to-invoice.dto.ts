import { IsUUID } from 'class-validator';

/**
 * PurchaseOrderItem carries no `warehouseId` (Phase 1, ADR-0015 — no
 * per-line warehouse anywhere in Purchasing until goods actually move), so
 * "Convert to Invoice" (Goods Receipt) is the first point a warehouse is
 * needed — one destination warehouse for the whole receipt, applied to
 * every converted line (the common case: a receiving dock is one warehouse
 * per receiving event). `PurchaseOrder.receivingWarehouseId` stays an
 * inert "Preparation For Future" placeholder per ADR-0015 — not wired up
 * here, since that would be implementing logic the ADR explicitly deferred.
 */
export class ConvertPurchaseOrderToInvoiceDto {
  @IsUUID()
  warehouseId!: string;
}
