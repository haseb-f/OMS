import {
  Prisma,
  SalesDocumentStatus,
  StoreOrderRecognitionStatus,
} from '@prisma/client';

const POSTED: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];

/** Recognised states a posted return may move between (FAILED / NOT_DUE are never overwritten). */
const RECOGNISED: StoreOrderRecognitionStatus[] = [
  StoreOrderRecognitionStatus.RECOGNIZED,
  StoreOrderRecognitionStatus.RETURN_PENDING,
  StoreOrderRecognitionStatus.PARTIALLY_RETURNED,
  StoreOrderRecognitionStatus.RETURNED,
];

/**
 * Pure rule: RETURNED when every delivered (invoiced) quantity came back on
 * posted returns, PARTIALLY_RETURNED when some did, null when none did.
 */
export function returnStatusFor(
  invoiced: Array<{ id: string; quantity: number }>,
  returnedByLine: Map<string, number>,
): StoreOrderRecognitionStatus | null {
  const returned = invoiced.reduce(
    (sum, line) =>
      sum + Math.min(returnedByLine.get(line.id) ?? 0, line.quantity),
    0,
  );
  if (returned <= 0) return null;
  const delivered = invoiced.reduce((sum, line) => sum + line.quantity, 0);
  return returned >= delivered
    ? StoreOrderRecognitionStatus.RETURNED
    : StoreOrderRecognitionStatus.PARTIALLY_RETURNED;
}

/**
 * R15 (D15-10) — after a return of a store order's goods is posted, the
 * order's recognition state says whether everything delivered came back
 * (RETURNED) or part of it (PARTIALLY_RETURNED); RETURN_PENDING is resolved.
 * Runs inside the confirming transaction.
 */
export async function recomputeStoreOrderReturnStatus(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
): Promise<StoreOrderRecognitionStatus | null> {
  const order = await tx.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: { recognitionStatus: true },
  });
  if (!order || !RECOGNISED.includes(order.recognitionStatus)) return null;
  const invoiced = await tx.salesInvoiceItem.findMany({
    where: {
      deletedAt: null,
      salesInvoice: { storeOrderId, deletedAt: null, status: { in: POSTED } },
    },
    select: { id: true, quantity: true },
  });
  const returned = await tx.salesReturnItem.groupBy({
    by: ['salesInvoiceItemId'],
    where: {
      salesInvoiceItemId: { in: invoiced.map((line) => line.id) },
      salesReturn: { deletedAt: null, status: { in: POSTED } },
    },
    _sum: { quantity: true },
  });
  const next = returnStatusFor(
    invoiced,
    new Map(
      returned
        .filter((row) => row.salesInvoiceItemId)
        .map((row) => [
          row.salesInvoiceItemId as string,
          row._sum.quantity ?? 0,
        ]),
    ),
  );
  if (!next || next === order.recognitionStatus) return next;
  await tx.storeOrder.update({
    where: { id: storeOrderId },
    data: { recognitionStatus: next },
  });
  return next;
}
