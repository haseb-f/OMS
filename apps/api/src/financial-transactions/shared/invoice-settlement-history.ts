import {
  FinancialTransactionStatus,
  type PrismaClient,
  type Prisma,
} from '@prisma/client';
import { PERMISSION_CATALOG } from '../../permissions/permission-catalog';
import type { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import {
  appliedCreditByReturn,
  loadInvoiceSettlements,
  loadReturnCredits,
  type InvoiceKey,
  type InvoicePaymentSummary,
} from './invoice-payment.util';
import { STORE_ORDER_PAYMENT_NOTE_PREFIX } from './store-order-receipts';

/**
 * R22 contract 2 — one line of an invoice's settlement history: a voucher
 * allocation (cash) or a posted return (credit / debit note) applied to it.
 */
export interface InvoiceSettlementEntry {
  kind: 'PAYMENT' | 'CREDIT_NOTE';
  documentId: string;
  documentNumber: string;
  /** CUSTOMER_RECEIPT | SUPPLIER_PAYMENT | SALES_RETURN | PURCHASE_RETURN */
  documentType: string;
  /** Allocation date (payment) / posting date (credit note), ISO. */
  date: string;
  /** Voucher / return workflow status. */
  status: string;
  /** Allocated (payment) / applied credit (credit note), invoice currency. */
  amount: number;
  currencyCode: string | null;
  allocationId?: string;
  /** The caller may remove this allocation (confirmed voucher, `edit` right). */
  canUnallocate: boolean;
  /** The caller may cancel (reverse) the voucher itself (`cancel` right). */
  canCancel: boolean;
}

export interface InvoiceSettlementHistory {
  summary: InvoicePaymentSummary & { currencyCode: string | null };
  entries: InvoiceSettlementEntry[];
}

/** What the caller may do on the vouchers listed (resolved from permissions by the controller). */
export interface SettlementAbilities {
  canEditVouchers: boolean;
  canCancelVouchers: boolean;
}

type HistoryClient = Pick<
  PrismaClient,
  | 'financialTransactionAllocation'
  | 'financialTransactionAllocationEvent'
  | 'salesReturn'
  | 'purchaseReturn'
>;

/** The catalog permission name of `moduleKey.action` (the same lookup the PermissionsGuard does). */
export function catalogPermissionName(
  moduleKey: string,
  action: string,
): string | null {
  return (
    PERMISSION_CATALOG.find((module) => module.key === moduleKey)?.actions.find(
      (entry) => entry.action === action,
    )?.name ?? null
  );
}

/** Edit / cancel rights on the voucher module that settles this invoice side. */
export async function resolveSettlementAbilities(
  permissions: Pick<PermissionsResolverService, 'hasPermission'>,
  userId: string,
  voucherModule: 'customer-receipts' | 'supplier-payments',
): Promise<SettlementAbilities> {
  const can = async (action: string) => {
    const name = catalogPermissionName(voucherModule, action);
    return name ? permissions.hasPermission(userId, name) : false;
  };
  const [canEditVouchers, canCancelVouchers] = await Promise.all([
    can('edit'),
    can('cancel'),
  ]);
  return { canEditVouchers, canCancelVouchers };
}

/**
 * Builds the history from the same sources as the settlement summary:
 * confirmed (and draft, marked as such — a draft pays nothing) voucher
 * allocations and the credit of posted returns actually applied.
 */
export async function loadInvoiceSettlementHistory(
  client: HistoryClient,
  invoiceKey: InvoiceKey,
  invoice: {
    id: string;
    grandTotal: Prisma.Decimal | number;
    status: string;
    currency: { code: string } | null;
  },
  abilities: SettlementAbilities,
): Promise<InvoiceSettlementHistory> {
  const currencyCode = invoice.currency?.code ?? null;
  const [settlements, credits, allocations] = await Promise.all([
    loadInvoiceSettlements(client, invoiceKey, [invoice]),
    loadReturnCredits(client, invoiceKey, [invoice.id]),
    client.financialTransactionAllocation.findMany({
      where: {
        [invoiceKey]: invoice.id,
        transaction: {
          deletedAt: null,
          status: {
            in: [
              FinancialTransactionStatus.CONFIRMED,
              FinancialTransactionStatus.DRAFT,
            ],
          },
        },
      },
      select: {
        id: true,
        allocatedAmount: true,
        allocationDate: true,
        transaction: {
          select: {
            id: true,
            transactionNumber: true,
            type: true,
            status: true,
            notes: true,
            paymentReceiptLink: { select: { paymentId: true } },
          },
        },
      },
      orderBy: [{ allocationDate: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const summary = settlements.get(invoice.id)!;
  const applied = appliedCreditByReturn(
    credits,
    new Map([[invoice.id, summary.creditedTotal]]),
  );
  const returnNumbers = await returnNumbersOf(
    client,
    invoiceKey,
    credits.map((credit) => credit.returnId),
  );

  const entries: InvoiceSettlementEntry[] = allocations.map((line) => {
    const voucher = line.transaction;
    const confirmed = voucher.status === FinancialTransactionStatus.CONFIRMED;
    // A store-order claim receipt is corrected from the payment / the
    // reconciliation workspace, never cancelled from here.
    const claimReceipt =
      !!voucher.paymentReceiptLink ||
      !!voucher.notes?.startsWith(STORE_ORDER_PAYMENT_NOTE_PREFIX);
    return {
      kind: 'PAYMENT',
      documentId: voucher.id,
      documentNumber: voucher.transactionNumber,
      documentType: voucher.type,
      date: line.allocationDate.toISOString(),
      status: voucher.status,
      amount: Math.round(Number(line.allocatedAmount) * 100) / 100,
      currencyCode,
      allocationId: line.id,
      canUnallocate: confirmed && abilities.canEditVouchers,
      canCancel: confirmed && !claimReceipt && abilities.canCancelVouchers,
    };
  });
  for (const credit of credits) {
    const amount = applied.get(credit.returnId) ?? 0;
    if (amount <= 0) continue;
    entries.push({
      kind: 'CREDIT_NOTE',
      documentId: credit.returnId,
      documentNumber: returnNumbers.get(credit.returnId)?.number ?? '',
      documentType:
        invoiceKey === 'salesInvoiceId' ? 'SALES_RETURN' : 'PURCHASE_RETURN',
      date: credit.postedAt.toISOString(),
      status: returnNumbers.get(credit.returnId)?.status ?? 'CONFIRMED',
      amount,
      currencyCode,
      canUnallocate: false,
      canCancel: false,
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { summary: { ...summary, currencyCode }, entries };
}

async function returnNumbersOf(
  client: HistoryClient,
  invoiceKey: InvoiceKey,
  returnIds: string[],
): Promise<Map<string, { number: string; status: string }>> {
  if (returnIds.length === 0) return new Map();
  const rows =
    invoiceKey === 'salesInvoiceId'
      ? await client.salesReturn.findMany({
          where: { id: { in: returnIds } },
          select: { id: true, returnNumber: true, status: true },
        })
      : await client.purchaseReturn.findMany({
          where: { id: { in: returnIds } },
          select: { id: true, returnNumber: true, status: true },
        });
  return new Map(
    rows.map((row) => [
      row.id,
      { number: row.returnNumber, status: row.status },
    ]),
  );
}
