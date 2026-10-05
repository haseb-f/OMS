import type { PostSalesDeliveryDto } from './post-sales-delivery.dto';

/**
 * R13 — optional traceability / duplicate-protection fields of a
 * document-driven stock writer (`postSalesDelivery`, `postSalesReturn`,
 * `postPurchaseReceipt`, `postPurchaseReturn`, `reserve`, `release`).
 *
 * Deliberately an interface intersected into the service signatures, not a
 * DTO class field: these are set by server-side callers only and must never be
 * accepted from an HTTP body.
 */
export interface MovementTrace {
  /**
   * Unique per movement — see `movementIdempotencyKey`. A second insert with the
   * same key is rejected with 409 `INVENTORY_DUPLICATE_MOVEMENT`.
   */
  idempotencyKey?: string;
  /** Kit sale/return: the kit product whose component this movement is. */
  parentProductId?: string;
  /** Kit sale/return: the recipe version that exploded the kit. */
  recipeId?: string;
}

/** A reservation (`referenceType` + `referenceId`) that a delivery may consume. */
export interface OwnReservationRef {
  referenceType: string;
  referenceId: string;
}

export type PostSalesDeliveryInput = PostSalesDeliveryDto &
  MovementTrace & {
    /**
     * Reservation of the SAME business flow (e.g. the Sales Order a Sales
     * Invoice fulfils) that this delivery consumes: its reserved quantity (up
     * to the delivered quantity) does not count against availability.
     */
    ignoreReservedForReference?: OwnReservationRef;
  };

/**
 * Idempotency-key convention: `<referenceType>:<referenceId>:<lineId|productId>:<type>`
 * (type = the InventoryMovementType, e.g. `SALES_DELIVERY`).
 */
export function movementIdempotencyKey(
  referenceType: string,
  referenceId: string,
  lineOrProductId: string,
  type: string,
): string {
  return `${referenceType}:${referenceId}:${lineOrProductId}:${type}`;
}
