import { JournalEntryStatus, Prisma } from '@prisma/client';

export interface SourceJournalRef {
  id: string;
  entryNumber: string;
  entryDate: Date;
}

/**
 * The current POSTED journal entry of each source (sourceType + sourceId) —
 * how a schedule row, an asset or a prepayment finds the entry the Posting
 * Engine created for it. One query for any number of sources.
 */
export async function postedEntriesBySource(
  client: Prisma.TransactionClient,
  sourceType: string,
  sourceIds: string[],
): Promise<Map<string, SourceJournalRef>> {
  const result = new Map<string, SourceJournalRef>();
  if (sourceIds.length === 0) return result;
  const entries = await client.journalEntry.findMany({
    where: {
      sourceType,
      sourceId: { in: sourceIds },
      status: JournalEntryStatus.POSTED,
      reversalOfEntryId: null,
      deletedAt: null,
    },
    select: { id: true, entryNumber: true, entryDate: true, sourceId: true },
  });
  for (const entry of entries) {
    if (entry.sourceId) {
      result.set(entry.sourceId, {
        id: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
      });
    }
  }
  return result;
}

/** Display shape of the purchase invoice line an asset / prepayment came from. */
export const SOURCE_INVOICE_SELECT = {
  purchaseInvoice: {
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      confirmedAt: true,
      partner: { select: { id: true, name: true } },
    },
  },
  purchaseInvoiceItem: {
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      taxAmount: true,
      treatment: true,
      product: { select: { id: true, name: true, displayName: true } },
    },
  },
} as const;
