/** Reference type of every assembly-order movement and of its journal. */
export const ASSEMBLY_REFERENCE_TYPE = 'ASSEMBLY_ORDER';

/** Posting source of the variance a reversal books when the finished item's average moved since the assembly (R13 M3). */
export const ASSEMBLY_REVERSAL_VARIANCE_TYPE = 'ASSEMBLY_REVERSAL_VARIANCE';

/**
 * Idempotency key of the movement that takes the finished quantity back out
 * on a reversal. Its `unitCost` is the average the units left the pool at —
 * the variance provider reads it back from there (stored, immutable data).
 */
export function assemblyReversalOutputKey(
  orderId: string,
  productId: string,
): string {
  return `${ASSEMBLY_REFERENCE_TYPE}:${orderId}:${productId}:PRODUCTION_OUTPUT:REVERSAL`;
}
