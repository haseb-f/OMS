import { Injectable } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  JournalEntryStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STORE_ORDER_PAYMENT_NOTE_PREFIX } from '../../financial-transactions/shared/store-order-receipts';
import {
  evaluateVoucherIntegrity,
  type InvoiceAllocationView,
  type VoucherView,
} from './voucher-integrity';

const VOUCHER_TYPES = [
  FinancialTransactionType.CUSTOMER_RECEIPT,
  FinancialTransactionType.SUPPLIER_PAYMENT,
];

/**
 * R18 — `GET /accounting/reports/voucher-integrity`: read-only check that
 * receipts / payments, their allocations, their journal entries and matched
 * bank lines agree (rules in `voucher-integrity.ts`). Never writes.
 */
@Injectable()
export class VoucherIntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  async run() {
    const rows = await this.prisma.financialTransaction.findMany({
      where: {
        deletedAt: null,
        type: { in: VOUCHER_TYPES },
        status: {
          in: [
            FinancialTransactionStatus.CONFIRMED,
            FinancialTransactionStatus.CANCELLED,
          ],
        },
      },
      select: {
        id: true,
        transactionNumber: true,
        type: true,
        status: true,
        amount: true,
        feeAmount: true,
        exchangeRate: true,
        debitAccountId: true,
        notes: true,
        receivingAccount: { select: { chartOfAccountId: true } },
        partner: { select: { name: true } },
        paymentReceiptLink: { select: { paymentId: true } },
        allocations: {
          select: {
            allocatedAmount: true,
            storeOrderId: true,
            salesInvoice: { select: { invoiceNumber: true } },
            purchaseInvoice: { select: { invoiceNumber: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const vouchers: VoucherView[] = rows.map((row) => ({
      id: row.id,
      transactionNumber: row.transactionNumber,
      type: row.type as VoucherView['type'],
      status: row.status as VoucherView['status'],
      amount: Number(row.amount),
      feeAmount: Number(row.feeAmount ?? 0),
      exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
      cashAccountId:
        (row.type === FinancialTransactionType.CUSTOMER_RECEIPT
          ? row.debitAccountId
          : null) ??
        row.receivingAccount?.chartOfAccountId ??
        null,
      partnerName: row.partner?.name ?? null,
      storeOrderReceipt:
        !!row.paymentReceiptLink ||
        !!row.notes?.startsWith(STORE_ORDER_PAYMENT_NOTE_PREFIX) ||
        row.allocations.some((line) => line.storeOrderId),
      allocations: row.allocations.map((line) => ({
        allocatedAmount: Number(line.allocatedAmount),
        invoiceNumber:
          line.salesInvoice?.invoiceNumber ??
          line.purchaseInvoice?.invoiceNumber ??
          null,
      })),
    }));

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        deletedAt: null,
        status: JournalEntryStatus.POSTED,
        sourceType: { in: VOUCHER_TYPES },
        sourceId: { in: vouchers.map((voucher) => voucher.id) },
      },
      select: {
        sourceId: true,
        reversalOfEntryId: true,
        lines: { select: { accountId: true, debit: true, credit: true } },
      },
    });

    const [sales, purchases, bankRows] = await Promise.all([
      this.invoiceAllocations('salesInvoiceId'),
      this.invoiceAllocations('purchaseInvoiceId'),
      this.prisma.bankTransaction.findMany({
        where: {
          deletedAt: null,
          OR: [
            { matchedPaymentId: { not: null } },
            { matchedFinancialTransactionId: { not: null } },
          ],
        },
        select: {
          id: true,
          transactionId: true,
          reference: true,
          amount: true,
          matchedPayment: { select: { paymentNumber: true, amount: true } },
          matchedFinancialTransaction: {
            select: { transactionNumber: true, amount: true },
          },
        },
      }),
    ]);

    const issues = evaluateVoucherIntegrity({
      vouchers,
      entries: entries.map((entry) => ({
        sourceId: entry.sourceId as string,
        reversalOfEntryId: entry.reversalOfEntryId,
        reversed: false,
        lines: entry.lines.map((line) => ({
          accountId: line.accountId,
          debit: Number(line.debit),
          credit: Number(line.credit),
        })),
      })),
      invoices: [...sales, ...purchases],
      bankMatches: bankRows.map((row) => {
        const document = row.matchedFinancialTransaction
          ? {
              number: row.matchedFinancialTransaction.transactionNumber,
              amount: Number(row.matchedFinancialTransaction.amount),
            }
          : {
              number: row.matchedPayment?.paymentNumber ?? '—',
              amount: Number(row.matchedPayment?.amount ?? 0),
            };
        return {
          id: row.id,
          reference: row.transactionId ?? row.reference ?? row.id,
          bankAmount: Number(row.amount),
          documentNumber: document.number,
          documentAmount: document.amount,
        };
      }),
    });

    return {
      checkedAt: new Date(),
      checked: {
        vouchers: vouchers.length,
        entries: entries.length,
        invoices: sales.length + purchases.length,
        bankMatches: bankRows.length,
      },
      errors: issues.filter((issue) => issue.severity === 'ERROR').length,
      review: issues.filter((issue) => issue.severity === 'REVIEW').length,
      issues,
    };
  }

  private async invoiceAllocations(
    key: 'salesInvoiceId' | 'purchaseInvoiceId',
  ): Promise<InvoiceAllocationView[]> {
    const grouped = await this.prisma.financialTransactionAllocation.groupBy({
      by: [key],
      where: {
        [key]: { not: null },
        transaction: {
          status: FinancialTransactionStatus.CONFIRMED,
          deletedAt: null,
        },
      },
      _sum: { allocatedAmount: true },
    });
    const ids = grouped
      .map((row) => row[key])
      .filter((id): id is string => !!id);
    if (ids.length === 0) return [];
    const select = {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      partner: { select: { name: true } },
    } as const;
    const invoices =
      key === 'salesInvoiceId'
        ? await this.prisma.salesInvoice.findMany({
            where: { id: { in: ids } },
            select,
          })
        : await this.prisma.purchaseInvoice.findMany({
            where: { id: { in: ids } },
            select,
          });
    const allocated = new Map(
      grouped.map((row) => [row[key], Number(row._sum.allocatedAmount ?? 0)]),
    );
    return invoices.map((invoice) => ({
      documentType:
        key === 'salesInvoiceId' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE',
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      partnerName: invoice.partner?.name ?? null,
      grandTotal: Number(invoice.grandTotal),
      allocatedTotal: allocated.get(invoice.id) ?? 0,
    }));
  }
}
