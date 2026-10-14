import { Injectable } from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  JournalEntryStatus,
  PartnerRoleType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STORE_ORDER_PAYMENT_NOTE_PREFIX } from '../../financial-transactions/shared/store-order-receipts';
import { loadInvoiceSettlements } from '../../financial-transactions/shared/invoice-payment.util';
import { AccountingReportsService } from './accounting-reports.service';
import {
  evaluateSettlementIntegrity,
  evaluateVoucherIntegrity,
  type InvoiceAllocationView,
  type PartnerCurrencyBalanceView,
  type SettlementLineView,
  type VoucherView,
} from './voucher-integrity';

const VOUCHER_TYPES = [
  FinancialTransactionType.CUSTOMER_RECEIPT,
  FinancialTransactionType.SUPPLIER_PAYMENT,
  // R22-T (D4) — one entry per voucher, cash line = amount × rate (a
  // transfer's checked line is its source account).
  FinancialTransactionType.OTHER_RECEIPT,
  FinancialTransactionType.OTHER_PAYMENT,
  FinancialTransactionType.INTERNAL_TRANSFER,
];

/**
 * R18 — `GET /accounting/reports/voucher-integrity`: read-only check that
 * receipts / payments, their allocations, their journal entries and matched
 * bank lines agree (rules in `voucher-integrity.ts`). Never writes.
 */
@Injectable()
export class VoucherIntegrityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: AccountingReportsService,
  ) {}

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
            receiptId: true,
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
        // R22-T — a receipt partly refunded (consumption row) keeps the rest as credit by design.
        row.allocations.some((line) => line.storeOrderId || line.receiptId),
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

    const [balances, lines] = await Promise.all([
      this.partnerCurrencyBalances(),
      this.settlementLines(),
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

    // R22 — settlement integrity (aging vs ledger, agent / cancelled / draft allocations).
    issues.push(...evaluateSettlementIntegrity({ balances, lines }));

    return {
      checkedAt: new Date(),
      checked: {
        vouchers: vouchers.length,
        entries: entries.length,
        invoices: sales.length + purchases.length,
        bankMatches: bankRows.length,
        partnerBalances: balances.length,
      },
      errors: issues.filter((issue) => issue.severity === 'ERROR').length,
      review: issues.filter((issue) => issue.severity === 'REVIEW').length,
      issues,
    };
  }

  /**
   * R22 — every customer / supplier × currency: the control-account ledger
   * of entries in that currency against the aging net in that currency.
   */
  private async partnerCurrencyBalances(): Promise<
    PartnerCurrencyBalanceView[]
  > {
    const [ar, ap, settings, ledgerRows] = await Promise.all([
      this.reports.arAging({}),
      this.reports.apAging({}),
      this.prisma.postingSettings.findFirst({
        select: { functionalCurrencyId: true },
      }),
      this.prisma.$queryRaw<
        {
          partnerId: string;
          currencyId: string | null;
          controlType: string;
          debit: Prisma.Decimal | null;
          credit: Prisma.Decimal | null;
        }[]
      >(Prisma.sql`
        SELECT l.partner_id AS "partnerId",
               e.currency_id AS "currencyId",
               a.partner_control_type::text AS "controlType",
               SUM(l.debit) AS debit,
               SUM(l.credit) AS credit
        FROM journal_entry_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id
        JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE l.partner_id IS NOT NULL
          AND a.partner_control_type IS NOT NULL
          AND e.deleted_at IS NULL
          AND e.status::text IN (${JournalEntryStatus.POSTED}, ${JournalEntryStatus.REVERSED})
        GROUP BY 1, 2, 3
      `),
    ]);
    const functionalId = settings?.functionalCurrencyId ?? null;
    type Key = string;
    const rows = new Map<Key, PartnerCurrencyBalanceView>();
    const keyOf = (
      side: string,
      partnerId: string,
      currencyId: string | null,
    ) => `${side}|${partnerId}|${currencyId ?? functionalId ?? ''}`;
    const row = (
      side: 'AR' | 'AP',
      partnerId: string,
      currencyId: string | null,
    ) => {
      const key = keyOf(side, partnerId, currencyId);
      const existing = rows.get(key);
      if (existing) return existing;
      const normalized = currencyId ?? functionalId;
      const created: PartnerCurrencyBalanceView = {
        side,
        partnerId,
        partnerName: null,
        currencyId: normalized,
        currencyCode: null,
        functional: normalized === functionalId,
        ledger: 0,
        agingNet: 0,
      };
      rows.set(key, created);
      return created;
    };
    for (const [side, report] of [
      ['AR', ar],
      ['AP', ap],
    ] as const) {
      for (const partner of report.partners) {
        const target = row(side, partner.partnerId, partner.currencyId);
        target.partnerName = partner.partnerName;
        target.currencyCode = partner.currencyCode;
        target.agingNet += partner.net;
      }
    }
    for (const line of ledgerRows) {
      const side =
        line.controlType === 'RECEIVABLE'
          ? 'AR'
          : line.controlType === 'PAYABLE'
            ? 'AP'
            : null;
      if (!side) continue;
      const net = Number(line.debit ?? 0) - Number(line.credit ?? 0);
      row(side, line.partnerId, line.currencyId).ledger +=
        side === 'AR' ? net : -net;
    }
    // Only customers on AR and suppliers on AP: agents, investors and
    // partners carry control-account balances no invoice aging explains.
    const partnerIds = [...new Set([...rows.values()].map((r) => r.partnerId))];
    const partners = await this.prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, name: true, roles: { select: { role: true } } },
    });
    const byId = new Map(partners.map((partner) => [partner.id, partner]));
    const currencies = new Map(
      (
        await this.prisma.currency.findMany({
          where: {
            id: {
              in: [...rows.values()]
                .map((r) => r.currencyId)
                .filter((id): id is string => !!id),
            },
          },
          select: { id: true, code: true },
        })
      ).map((currency) => [currency.id, currency.code]),
    );
    return [...rows.values()].filter((balance) => {
      const partner = byId.get(balance.partnerId);
      if (!partner) return false;
      balance.partnerName ??= partner.name;
      balance.currencyCode ??= balance.currencyId
        ? (currencies.get(balance.currencyId) ?? null)
        : null;
      const role =
        balance.side === 'AR'
          ? PartnerRoleType.CUSTOMER
          : PartnerRoleType.SUPPLIER;
      return partner.roles.some((entry) => entry.role === role);
    });
  }

  /**
   * R22 — invoice allocation lines of confirmed agent collections, of
   * cancelled vouchers and of drafts (with what the invoice owes today).
   */
  private async settlementLines(): Promise<SettlementLineView[]> {
    const rows = await this.prisma.financialTransactionAllocation.findMany({
      where: {
        OR: [
          { salesInvoiceId: { not: null } },
          { purchaseInvoiceId: { not: null } },
        ],
        transaction: {
          deletedAt: null,
          type: { in: VOUCHER_TYPES },
          OR: [
            {
              status: {
                in: [
                  FinancialTransactionStatus.CANCELLED,
                  FinancialTransactionStatus.DRAFT,
                ],
              },
            },
            {
              status: FinancialTransactionStatus.CONFIRMED,
              paymentReceiptLink: {
                is: { payment: { agentId: { not: null } } },
              },
            },
          ],
        },
      },
      select: {
        allocatedAmount: true,
        salesInvoice: {
          select: { id: true, invoiceNumber: true, grandTotal: true },
        },
        purchaseInvoice: {
          select: { id: true, invoiceNumber: true, grandTotal: true },
        },
        transaction: {
          select: {
            id: true,
            transactionNumber: true,
            type: true,
            status: true,
            partner: { select: { name: true } },
            paymentReceiptLink: {
              select: { payment: { select: { agentId: true } } },
            },
          },
        },
      },
    });
    const drafts = rows.filter(
      (row) => row.transaction.status === FinancialTransactionStatus.DRAFT,
    );
    const [salesRemaining, purchaseRemaining] = await Promise.all([
      loadInvoiceSettlements(
        this.prisma,
        'salesInvoiceId',
        drafts.flatMap((row) => (row.salesInvoice ? [row.salesInvoice] : [])),
      ),
      loadInvoiceSettlements(
        this.prisma,
        'purchaseInvoiceId',
        drafts.flatMap((row) =>
          row.purchaseInvoice ? [row.purchaseInvoice] : [],
        ),
      ),
    ]);
    return rows.map((row) => {
      const invoice = row.salesInvoice ?? row.purchaseInvoice;
      const remaining = row.salesInvoice
        ? salesRemaining.get(row.salesInvoice.id)
        : row.purchaseInvoice
          ? purchaseRemaining.get(row.purchaseInvoice.id)
          : undefined;
      return {
        voucherId: row.transaction.id,
        voucherNumber: row.transaction.transactionNumber,
        voucherType: row.transaction.type,
        voucherStatus: row.transaction.status,
        partnerName: row.transaction.partner?.name ?? null,
        agentCollection: !!row.transaction.paymentReceiptLink?.payment.agentId,
        invoiceNumber: invoice?.invoiceNumber ?? null,
        allocatedAmount: Number(row.allocatedAmount),
        invoiceRemaining: remaining ? remaining.remainingBalance : null,
      };
    });
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
