import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import type {
  TraceGroup,
  TraceGroupKey,
  TraceKind,
  TraceRecord,
  TraceResult,
  TraceState,
} from './traceability.types';

/** Notes prefix the Store Order collection service stamps on the Customer
 *  Receipt it creates for a verified Payment (one receipt per payment). */
export const STORE_ORDER_PAYMENT_NOTE_PREFIX = 'STORE_ORDER_PAYMENT:';

/** Drops the internal sourceId used for per-source JE checks. */
function withoutSource({
  kind,
  id,
  number,
  status,
  sourceType,
}: TraceRecord): TraceRecord {
  return { kind, id, number, status, sourceType };
}

/** A shipment has no document number of its own: "#<attempt> · <tracking>". */
function shipmentNumber(attempt: number, tracking: string | null): string {
  return tracking ? `#${attempt} · ${tracking}` : `#${attempt}`;
}

/** Who may see each kind of linked record. */
const VIEW_PERMISSION: Record<TraceKind, string> = {
  SALES_QUOTATION: 'sales.quotations.view',
  SALES_ORDER: 'sales.orders.view',
  SALES_INVOICE: 'sales.invoices.view',
  SALES_RETURN: 'sales.returns.view',
  CUSTOMER_RECEIPT: 'sales.receipts.view',
  CUSTOMER_REFUND: 'sales.refunds.view',
  CUSTOMER: 'partners.view',
  PURCHASE_QUOTATION: 'purchasing.quotations.view',
  PURCHASE_ORDER: 'purchasing.orders.view',
  PURCHASE_INVOICE: 'purchasing.invoices.view',
  PURCHASE_RETURN: 'purchasing.returns.view',
  SUPPLIER_PAYMENT: 'purchasing.payments.view',
  EXPENSE_PAYMENT: 'accounting.expense-payments.view',
  LANDED_COST: 'landed-cost.view',
  STORE_ORDER: 'store-orders.view',
  PAYMENT: 'sales.receipts.view',
  SHIPMENT: 'shipping.view',
  JOURNAL_ENTRY: 'accounting.journal-entries.view',
  INVENTORY_MOVEMENT: 'inventory.view',
  FIXED_ASSET: 'masterdata.fixed-assets.view',
  PREPAID_EXPENSE: 'prepaid-expenses.view',
};

/** JE sourceType → the record the viewer should land on. Schedule rows
 *  (a depreciation period, a prepaid recognition) resolve to their parent. */
const JOURNAL_SOURCE_KIND: Record<string, TraceKind> = {
  SALES_INVOICE: 'SALES_INVOICE',
  SALES_RETURN: 'SALES_RETURN',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  CUSTOMER_RECEIPT: 'CUSTOMER_RECEIPT',
  CUSTOMER_REFUND: 'CUSTOMER_REFUND',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  EXPENSE_PAYMENT: 'EXPENSE_PAYMENT',
  LANDED_COST: 'LANDED_COST',
  FULFILLMENT_COST: 'STORE_ORDER',
  INVENTORY_ADJUSTMENT: 'INVENTORY_MOVEMENT',
  FIXED_ASSET_CAPITALIZATION: 'FIXED_ASSET',
  FIXED_ASSET_DISPOSAL: 'FIXED_ASSET',
  PREPAID_EXPENSE: 'PREPAID_EXPENSE',
};

/** Inventory movement referenceType → owning document kind. */
const MOVEMENT_REFERENCE_KIND: Record<string, TraceKind> = {
  SALES_ORDER_DOC: 'SALES_ORDER',
  SALES_INVOICE: 'SALES_INVOICE',
  SALES_RETURN: 'SALES_RETURN',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
};

/** Document statuses at which a posting document must already have a JE. */
const POSTED_STATUSES = new Set([
  'CONFIRMED',
  'CLOSED',
  'POSTED',
  'CAPITALIZED',
  'DISPOSED',
  'ACTIVE',
  'COMPLETED',
]);

/**
 * Upper bound on stock movements listed inline per traceability group. A
 * document past it is reported with `truncated`/`total` (never cut
 * silently) and the panel links to the full, filtered movements list.
 */
export const TRACE_MOVEMENT_LIMIT = 200;

/**
 * One canonical "what is this record connected to?" read model. Every
 * document page, Journal Entry and stock movement asks the same question
 * through here, so links are bidirectional by construction and a missing
 * JE on a posted document is reported as FAILED rather than silently absent.
 */
@Injectable()
export class TraceabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  async trace(
    kind: TraceKind,
    id: string,
    userId: string,
  ): Promise<TraceResult> {
    const graph = await this.load(kind, id);
    if (!graph) throw new NotFoundException(`${kind} ${id} not found`);

    const granted = await this.permissions.getPermissions(userId);
    const superAdmin = await this.permissions.isSuperAdmin(userId);
    const canSee = (target: TraceKind) =>
      superAdmin || granted.has(VIEW_PERMISSION[target]);

    const groups: TraceGroup[] = graph.groups.map((group) => {
      if (group.state === 'NOT_APPLICABLE' || group.state === 'PENDING') {
        return { ...group, items: [] };
      }
      const hidden = group.items.some((item) => !canSee(item.kind));
      const visible = group.items.filter((item) => canSee(item.kind));
      if (hidden && visible.length === 0) {
        return { key: group.key, state: 'UNAUTHORIZED', items: [] };
      }
      return { ...group, items: visible };
    });
    return { record: graph.record, groups };
  }

  // -------------------------------------------------------------------------

  private async load(
    kind: TraceKind,
    id: string,
  ): Promise<{ record: TraceRecord; groups: TraceGroup[] } | null> {
    switch (kind) {
      case 'SALES_QUOTATION':
        return this.salesQuotation(id);
      case 'SALES_ORDER':
        return this.salesOrder(id);
      case 'SALES_INVOICE':
        return this.salesInvoice(id);
      case 'SALES_RETURN':
        return this.salesReturn(id);
      case 'PURCHASE_QUOTATION':
        return this.purchaseQuotation(id);
      case 'PURCHASE_ORDER':
        return this.purchaseOrder(id);
      case 'PURCHASE_INVOICE':
        return this.purchaseInvoice(id);
      case 'PURCHASE_RETURN':
        return this.purchaseReturn(id);
      case 'CUSTOMER_RECEIPT':
      case 'CUSTOMER_REFUND':
      case 'SUPPLIER_PAYMENT':
      case 'EXPENSE_PAYMENT':
        return this.financialTransaction(id);
      case 'LANDED_COST':
        return this.landedCost(id);
      case 'STORE_ORDER':
        return this.storeOrder(id);
      case 'PAYMENT':
        return this.payment(id);
      case 'SHIPMENT':
        return this.shipment(id);
      case 'JOURNAL_ENTRY':
        return this.journalEntry(id);
      case 'INVENTORY_MOVEMENT':
        return this.inventoryMovement(id);
      case 'FIXED_ASSET':
        return this.fixedAsset(id);
      case 'PREPAID_EXPENSE':
        return this.prepaidExpense(id);
      default:
        return null;
    }
  }

  private group(
    key: TraceGroupKey,
    items: TraceRecord[],
    empty: TraceState = 'NOT_APPLICABLE',
  ): TraceGroup {
    return { key, state: items.length > 0 ? 'FOUND' : empty, items };
  }

  /** JE group for a posting document: FOUND, PENDING (not posted yet),
   *  FAILED (posted but no JE), or NOT_APPLICABLE (zero-value document). */
  private async journalGroup(
    sourceTypes: string[],
    sourceIds: string[],
    documentStatus: string,
    documentValue: number | null = null,
  ): Promise<TraceGroup> {
    const entries = await this.journalEntriesFor(sourceTypes, sourceIds);
    if (entries.length > 0)
      return { key: 'JOURNAL_ENTRIES', state: 'FOUND', items: entries };
    if (!POSTED_STATUSES.has(documentStatus)) {
      return { key: 'JOURNAL_ENTRIES', state: 'PENDING', items: [] };
    }
    if (documentValue !== null && Math.abs(documentValue) < 0.005) {
      return { key: 'JOURNAL_ENTRIES', state: 'NOT_APPLICABLE', items: [] };
    }
    return { key: 'JOURNAL_ENTRIES', state: 'FAILED', items: [] };
  }

  private async journalEntriesFor(
    sourceTypes: string[],
    sourceIds: string[],
  ): Promise<TraceRecord[]> {
    const rows = await this.journalEntriesWithSource(sourceTypes, sourceIds);
    return rows.map(withoutSource);
  }

  /** As `journalEntriesFor`, keeping each entry's sourceId for per-source checks. */
  private async journalEntriesWithSource(
    sourceTypes: string[],
    sourceIds: string[],
  ): Promise<(TraceRecord & { sourceId: string | null })[]> {
    if (sourceIds.length === 0) return [];
    const rows = await this.prisma.journalEntry.findMany({
      where: {
        sourceType: { in: sourceTypes },
        sourceId: { in: sourceIds },
        deletedAt: null,
      },
      select: {
        id: true,
        entryNumber: true,
        status: true,
        sourceType: true,
        sourceId: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      kind: 'JOURNAL_ENTRY' as const,
      id: row.id,
      number: row.entryNumber,
      status: row.status,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
    }));
  }

  /**
   * Stock movements of several source documents at once. Bounded at
   * `TRACE_MOVEMENT_LIMIT` for the panel, but never silently: past the
   * bound the result carries `truncated`/`total` plus the reference ids the
   * full, filtered inventory movements list can be opened with.
   */
  private async movementsForReferences(
    references: { types: string[]; id: string }[],
  ): Promise<{
    items: TraceRecord[];
    truncated?: true;
    total?: number;
    referenceIds?: string[];
  }> {
    if (references.length === 0) return { items: [] };
    const where: Prisma.InventoryMovementWhereInput = {
      OR: references.map((ref) => ({
        referenceType: { in: ref.types },
        referenceId: ref.id,
      })),
    };
    const rows = await this.prisma.inventoryMovement.findMany({
      where,
      select: { id: true, movementNumber: true, type: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: TRACE_MOVEMENT_LIMIT + 1,
    });
    const items = rows.slice(0, TRACE_MOVEMENT_LIMIT).map((row) => ({
      kind: 'INVENTORY_MOVEMENT' as const,
      id: row.id,
      number: row.movementNumber,
      status: row.type,
    }));
    if (rows.length <= TRACE_MOVEMENT_LIMIT) return { items };
    const total = await this.prisma.inventoryMovement.count({ where });
    return {
      items,
      truncated: true,
      total,
      referenceIds: [...new Set(references.map((ref) => ref.id))],
    };
  }

  private async movementsFor(
    referenceTypes: string[],
    referenceId: string,
    documentStatus: string | null,
  ): Promise<TraceGroup> {
    const { items, ...bounds } = await this.movementsForReferences([
      { types: referenceTypes, id: referenceId },
    ]);
    if (items.length > 0)
      return { key: 'STOCK_MOVEMENTS', state: 'FOUND', items, ...bounds };
    return {
      key: 'STOCK_MOVEMENTS',
      state:
        documentStatus && !POSTED_STATUSES.has(documentStatus)
          ? 'PENDING'
          : 'NOT_APPLICABLE',
      items: [],
    };
  }

  private async allocationsFor(
    field: 'salesInvoiceId' | 'purchaseInvoiceId',
    invoiceId: string,
  ): Promise<TraceRecord[]> {
    const rows = await this.prisma.financialTransactionAllocation.findMany({
      where: {
        [field]: invoiceId,
        transaction: { deletedAt: null },
      },
      select: {
        transaction: {
          select: {
            id: true,
            transactionNumber: true,
            status: true,
            type: true,
          },
        },
      },
    });
    const seen = new Set<string>();
    const records: TraceRecord[] = [];
    for (const row of rows) {
      if (seen.has(row.transaction.id)) continue;
      seen.add(row.transaction.id);
      records.push({
        kind: row.transaction.type,
        id: row.transaction.id,
        number: row.transaction.transactionNumber,
        status: row.transaction.status,
      });
    }
    return records;
  }

  /** Customer Refunds paying back these Sales Returns (credit notes). */
  private async refundsFor(salesReturnIds: string[]): Promise<TraceRecord[]> {
    if (salesReturnIds.length === 0) return [];
    const rows = await this.prisma.financialTransaction.findMany({
      where: {
        deletedAt: null,
        type: 'CUSTOMER_REFUND',
        allocations: { some: { salesReturnId: { in: salesReturnIds } } },
      },
      select: { id: true, transactionNumber: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      kind: 'CUSTOMER_REFUND' as const,
      id: row.id,
      number: row.transactionNumber,
      status: row.status,
    }));
  }

  // ---- Sales ---------------------------------------------------------------

  private async salesQuotation(id: string) {
    const q = await this.prisma.salesQuotation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, quotationNumber: true, status: true },
    });
    if (!q) return null;
    const orders = await this.prisma.salesOrderDocument.findMany({
      where: { quotationId: id, deletedAt: null },
      select: { id: true, orderNumber: true, status: true },
    });
    return {
      record: {
        kind: 'SALES_QUOTATION' as const,
        id: q.id,
        number: q.quotationNumber,
        status: q.status,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          orders.map((o) => ({
            kind: 'SALES_ORDER' as const,
            id: o.id,
            number: o.orderNumber,
            status: o.status,
          })),
          q.status === 'APPROVED' ||
            q.status === 'DRAFT' ||
            q.status === 'PENDING_APPROVAL'
            ? 'PENDING'
            : 'NOT_APPLICABLE',
        ),
        {
          key: 'JOURNAL_ENTRIES' as const,
          state: 'NOT_APPLICABLE' as const,
          items: [],
        },
      ],
    };
  }

  private async salesOrder(id: string) {
    const o = await this.prisma.salesOrderDocument.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        quotation: {
          select: { id: true, quotationNumber: true, status: true },
        },
        invoices: {
          where: { deletedAt: null },
          select: { id: true, invoiceNumber: true, status: true },
        },
      },
    });
    if (!o) return null;
    const documents: TraceRecord[] = [
      ...(o.quotation
        ? [
            {
              kind: 'SALES_QUOTATION' as const,
              id: o.quotation.id,
              number: o.quotation.quotationNumber,
              status: o.quotation.status,
            },
          ]
        : []),
      ...o.invoices.map((i) => ({
        kind: 'SALES_INVOICE' as const,
        id: i.id,
        number: i.invoiceNumber,
        status: i.status,
      })),
    ];
    return {
      record: {
        kind: 'SALES_ORDER' as const,
        id: o.id,
        number: o.orderNumber,
        status: o.status,
      },
      groups: [
        this.group('DOCUMENTS', documents, 'PENDING'),
        await this.movementsFor(['SALES_ORDER_DOC'], id, o.status),
        {
          key: 'JOURNAL_ENTRIES' as const,
          state: 'NOT_APPLICABLE' as const,
          items: [],
        },
      ],
    };
  }

  private async salesInvoice(id: string) {
    const inv = await this.prisma.salesInvoice.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        grandTotal: true,
        storeOrderId: true,
        salesOrder: { select: { id: true, orderNumber: true, status: true } },
        storeOrder: {
          select: { id: true, internalOrderId: true, paymentStatus: true },
        },
      },
    });
    if (!inv) return null;
    const returns = await this.prisma.salesReturn.findMany({
      where: { salesInvoiceId: id, deletedAt: null },
      select: { id: true, returnNumber: true, status: true },
    });
    const documents: TraceRecord[] = [
      ...(inv.salesOrder
        ? [
            {
              kind: 'SALES_ORDER' as const,
              id: inv.salesOrder.id,
              number: inv.salesOrder.orderNumber,
              status: inv.salesOrder.status,
            },
          ]
        : []),
      ...(inv.storeOrder
        ? [
            {
              kind: 'STORE_ORDER' as const,
              id: inv.storeOrder.id,
              number: inv.storeOrder.internalOrderId,
              status: inv.storeOrder.paymentStatus,
            },
          ]
        : []),
      ...returns.map((r) => ({
        kind: 'SALES_RETURN' as const,
        id: r.id,
        number: r.returnNumber,
        status: r.status,
      })),
    ];
    const payments = await this.allocationsFor('salesInvoiceId', id);
    const journal = await this.journalGroup(
      inv.storeOrderId
        ? ['SALES_INVOICE', 'FULFILLMENT_COST']
        : ['SALES_INVOICE'],
      inv.storeOrderId ? [id, inv.storeOrderId] : [id],
      inv.status,
      Number(inv.grandTotal),
    );
    return {
      record: {
        kind: 'SALES_INVOICE' as const,
        id: inv.id,
        number: inv.invoiceNumber,
        status: inv.status,
      },
      groups: [
        this.group('DOCUMENTS', documents),
        this.group(
          'PAYMENTS',
          payments,
          POSTED_STATUSES.has(inv.status) ? 'PENDING' : 'NOT_APPLICABLE',
        ),
        journal,
        await this.movementsFor(['SALES_INVOICE'], id, inv.status),
      ],
    };
  }

  private async salesReturn(id: string) {
    const r = await this.prisma.salesReturn.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        grandTotal: true,
        salesInvoice: {
          select: { id: true, invoiceNumber: true, status: true },
        },
      },
    });
    if (!r) return null;
    const refunds = await this.refundsFor([id]);
    const returnJournal = await this.journalGroup(
      ['SALES_RETURN'],
      [id],
      r.status,
      Number(r.grandTotal),
    );
    // The return's own JE state (PENDING/FAILED) is authoritative; posted
    // refunds add their JEs next to it.
    const refundEntries = await this.journalEntriesFor(
      ['CUSTOMER_REFUND'],
      refunds.map((refund) => refund.id),
    );
    const journal: TraceGroup =
      refundEntries.length === 0
        ? returnJournal
        : {
            key: 'JOURNAL_ENTRIES',
            state:
              returnJournal.state === 'FAILED'
                ? 'FAILED'
                : returnJournal.state === 'PENDING'
                  ? 'PENDING'
                  : 'FOUND',
            items: [...returnJournal.items, ...refundEntries],
          };
    return {
      record: {
        kind: 'SALES_RETURN' as const,
        id: r.id,
        number: r.returnNumber,
        status: r.status,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          r.salesInvoice
            ? [
                {
                  kind: 'SALES_INVOICE' as const,
                  id: r.salesInvoice.id,
                  number: r.salesInvoice.invoiceNumber,
                  status: r.salesInvoice.status,
                },
              ]
            : [],
        ),
        this.group(
          'PAYMENTS',
          refunds,
          POSTED_STATUSES.has(r.status) ? 'NONE' : 'NOT_APPLICABLE',
        ),
        journal,
        await this.movementsFor(['SALES_RETURN'], id, r.status),
      ],
    };
  }

  // ---- Purchasing ------------------------------------------------------------

  private async purchaseQuotation(id: string) {
    const q = await this.prisma.purchaseQuotation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, quotationNumber: true, status: true },
    });
    if (!q) return null;
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { quotationId: id, deletedAt: null },
      select: { id: true, poNumber: true, status: true },
    });
    return {
      record: {
        kind: 'PURCHASE_QUOTATION' as const,
        id: q.id,
        number: q.quotationNumber,
        status: q.status,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          orders.map((o) => ({
            kind: 'PURCHASE_ORDER' as const,
            id: o.id,
            number: o.poNumber,
            status: o.status,
          })),
          'PENDING',
        ),
        {
          key: 'JOURNAL_ENTRIES' as const,
          state: 'NOT_APPLICABLE' as const,
          items: [],
        },
      ],
    };
  }

  private async purchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        poNumber: true,
        status: true,
        quotation: {
          select: { id: true, quotationNumber: true, status: true },
        },
      },
    });
    if (!po) return null;
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { purchaseOrderId: id, deletedAt: null },
      select: { id: true, invoiceNumber: true, status: true },
    });
    const documents: TraceRecord[] = [
      ...(po.quotation
        ? [
            {
              kind: 'PURCHASE_QUOTATION' as const,
              id: po.quotation.id,
              number: po.quotation.quotationNumber,
              status: po.quotation.status,
            },
          ]
        : []),
      ...invoices.map((i) => ({
        kind: 'PURCHASE_INVOICE' as const,
        id: i.id,
        number: i.invoiceNumber,
        status: i.status,
      })),
    ];
    return {
      record: {
        kind: 'PURCHASE_ORDER' as const,
        id: po.id,
        number: po.poNumber,
        status: po.status,
      },
      groups: [
        this.group('DOCUMENTS', documents, 'PENDING'),
        {
          key: 'JOURNAL_ENTRIES' as const,
          state: 'NOT_APPLICABLE' as const,
          items: [],
        },
      ],
    };
  }

  private async purchaseInvoice(id: string) {
    const inv = await this.prisma.purchaseInvoice.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        grandTotal: true,
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
      },
    });
    if (!inv) return null;
    const [returns, landedCosts, assets, prepaids] = await Promise.all([
      this.prisma.purchaseReturn.findMany({
        where: { purchaseInvoiceId: id, deletedAt: null },
        select: { id: true, returnNumber: true, status: true },
      }),
      this.prisma.landedCostDocument.findMany({
        where: { purchaseInvoiceId: id, deletedAt: null },
        select: { id: true, documentNumber: true, status: true },
      }),
      this.prisma.fixedAsset.findMany({
        where: { purchaseInvoiceId: id, deletedAt: null },
        select: { id: true, code: true, name: true, status: true },
      }),
      this.prisma.prepaidExpense.findMany({
        where: { purchaseInvoiceId: id, deletedAt: null },
        select: { id: true, prepaidNumber: true, status: true },
      }),
    ]);
    const documents: TraceRecord[] = [
      ...(inv.purchaseOrder
        ? [
            {
              kind: 'PURCHASE_ORDER' as const,
              id: inv.purchaseOrder.id,
              number: inv.purchaseOrder.poNumber,
              status: inv.purchaseOrder.status,
            },
          ]
        : []),
      ...returns.map((r) => ({
        kind: 'PURCHASE_RETURN' as const,
        id: r.id,
        number: r.returnNumber,
        status: r.status,
      })),
      ...landedCosts.map((l) => ({
        kind: 'LANDED_COST' as const,
        id: l.id,
        number: l.documentNumber,
        status: l.status,
      })),
    ];
    const assetRecords: TraceRecord[] = [
      ...assets.map((a) => ({
        kind: 'FIXED_ASSET' as const,
        id: a.id,
        number: a.code ?? a.name,
        status: a.status,
      })),
      ...prepaids.map((p) => ({
        kind: 'PREPAID_EXPENSE' as const,
        id: p.id,
        number: p.prepaidNumber,
        status: p.status,
      })),
    ];
    return {
      record: {
        kind: 'PURCHASE_INVOICE' as const,
        id: inv.id,
        number: inv.invoiceNumber,
        status: inv.status,
      },
      groups: [
        this.group('DOCUMENTS', documents),
        this.group(
          'PAYMENTS',
          await this.allocationsFor('purchaseInvoiceId', id),
          POSTED_STATUSES.has(inv.status) ? 'PENDING' : 'NOT_APPLICABLE',
        ),
        await this.journalGroup(
          ['PURCHASE_INVOICE'],
          [id],
          inv.status,
          Number(inv.grandTotal),
        ),
        await this.movementsFor(['PURCHASE_INVOICE'], id, inv.status),
        this.group('ASSETS', assetRecords),
      ],
    };
  }

  private async purchaseReturn(id: string) {
    const r = await this.prisma.purchaseReturn.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        grandTotal: true,
        purchaseInvoice: {
          select: { id: true, invoiceNumber: true, status: true },
        },
      },
    });
    if (!r) return null;
    return {
      record: {
        kind: 'PURCHASE_RETURN' as const,
        id: r.id,
        number: r.returnNumber,
        status: r.status,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          r.purchaseInvoice
            ? [
                {
                  kind: 'PURCHASE_INVOICE' as const,
                  id: r.purchaseInvoice.id,
                  number: r.purchaseInvoice.invoiceNumber,
                  status: r.purchaseInvoice.status,
                },
              ]
            : [],
        ),
        await this.journalGroup(
          ['PURCHASE_RETURN'],
          [id],
          r.status,
          Number(r.grandTotal),
        ),
        await this.movementsFor(['PURCHASE_RETURN'], id, r.status),
      ],
    };
  }

  private async landedCost(id: string) {
    const doc = await this.prisma.landedCostDocument.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        documentNumber: true,
        status: true,
        purchaseInvoice: {
          select: { id: true, invoiceNumber: true, status: true },
        },
      },
    });
    if (!doc) return null;
    return {
      record: {
        kind: 'LANDED_COST' as const,
        id: doc.id,
        number: doc.documentNumber,
        status: doc.status,
      },
      groups: [
        this.group('DOCUMENTS', [
          {
            kind: 'PURCHASE_INVOICE' as const,
            id: doc.purchaseInvoice.id,
            number: doc.purchaseInvoice.invoiceNumber,
            status: doc.purchaseInvoice.status,
          },
        ]),
        await this.journalGroup(['LANDED_COST'], [id], doc.status),
      ],
    };
  }

  // ---- Money -------------------------------------------------------------------

  private async financialTransaction(id: string) {
    const tx = await this.prisma.financialTransaction.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        transactionNumber: true,
        type: true,
        status: true,
        amount: true,
        notes: true,
        partner: { select: { id: true, partnerNumber: true, status: true } },
        allocations: {
          select: {
            salesInvoice: {
              select: { id: true, invoiceNumber: true, status: true },
            },
            purchaseInvoice: {
              select: { id: true, invoiceNumber: true, status: true },
            },
            salesReturn: {
              select: { id: true, returnNumber: true, status: true },
            },
          },
        },
      },
    });
    if (!tx) return null;
    const documents: TraceRecord[] = [];
    // A refund has no document of its own to hang the customer on — link it.
    if (tx.type === 'CUSTOMER_REFUND' && tx.partner) {
      documents.push({
        kind: 'CUSTOMER',
        id: tx.partner.id,
        number: tx.partner.partnerNumber,
        status: tx.partner.status,
      });
    }
    for (const allocation of tx.allocations) {
      if (allocation.salesReturn) {
        documents.push({
          kind: 'SALES_RETURN',
          id: allocation.salesReturn.id,
          number: allocation.salesReturn.returnNumber,
          status: allocation.salesReturn.status,
        });
      }
      if (allocation.salesInvoice) {
        documents.push({
          kind: 'SALES_INVOICE',
          id: allocation.salesInvoice.id,
          number: allocation.salesInvoice.invoiceNumber,
          status: allocation.salesInvoice.status,
        });
      }
      if (allocation.purchaseInvoice) {
        documents.push({
          kind: 'PURCHASE_INVOICE',
          id: allocation.purchaseInvoice.id,
          number: allocation.purchaseInvoice.invoiceNumber,
          status: allocation.purchaseInvoice.status,
        });
      }
    }
    const payments: TraceRecord[] = [];
    if (tx.notes?.startsWith(STORE_ORDER_PAYMENT_NOTE_PREFIX)) {
      const payment = await this.prisma.payment.findFirst({
        where: { id: tx.notes.slice(STORE_ORDER_PAYMENT_NOTE_PREFIX.length) },
        select: { id: true, paymentNumber: true, status: true },
      });
      if (payment)
        payments.push({
          kind: 'PAYMENT',
          id: payment.id,
          number: payment.paymentNumber,
          status: payment.status,
        });
    }
    return {
      record: {
        kind: tx.type as TraceKind,
        id: tx.id,
        number: tx.transactionNumber,
        status: tx.status,
      },
      groups: [
        this.group('DOCUMENTS', documents),
        this.group('PAYMENTS', payments),
        await this.journalGroup([tx.type], [id], tx.status, Number(tx.amount)),
      ],
    };
  }

  private async storeOrder(id: string) {
    const order = await this.prisma.storeOrder.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, internalOrderId: true, paymentStatus: true },
    });
    if (!order) return null;
    const [invoices, payments, shipments] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { storeOrderId: id, deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          grandTotal: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { storeOrderId: id, deletedAt: null },
        select: { id: true, paymentNumber: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.shipment.findMany({
        where: { storeOrderId: id, deletedAt: null },
        select: {
          id: true,
          attemptNumber: true,
          trackingNumber: true,
          status: true,
        },
        orderBy: { attemptNumber: 'asc' },
      }),
    ]);
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const [returns, receipts] = await Promise.all([
      invoiceIds.length > 0
        ? this.prisma.salesReturn.findMany({
            where: { salesInvoiceId: { in: invoiceIds }, deletedAt: null },
            select: { id: true, returnNumber: true, status: true },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve(
            [] as { id: string; returnNumber: string; status: string }[],
          ),
      // Customer receipts: the one the collection service stamps per verified
      // Payment, plus any receipt allocated to this order's invoices.
      this.prisma.financialTransaction.findMany({
        where: {
          deletedAt: null,
          OR: [
            {
              notes: {
                in: payments.map(
                  (p) => `${STORE_ORDER_PAYMENT_NOTE_PREFIX}${p.id}`,
                ),
              },
            },
            ...(invoiceIds.length > 0
              ? [
                  {
                    allocations: {
                      some: { salesInvoiceId: { in: invoiceIds } },
                    },
                  },
                ]
              : []),
          ],
        },
        select: {
          id: true,
          transactionNumber: true,
          status: true,
          type: true,
          notes: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const returnIds = returns.map((r) => r.id);
    const receiptIds = receipts.map((r) => r.id);
    const refunds = await this.refundsFor(returnIds);
    const refundIds = refunds.map((r) => r.id);

    const entries = await this.journalEntriesWithSource(
      [
        'SALES_INVOICE',
        'FULFILLMENT_COST',
        'CUSTOMER_RECEIPT',
        'SALES_RETURN',
        'CUSTOMER_REFUND',
      ],
      [...invoiceIds, id, ...receiptIds, ...returnIds, ...refundIds],
    );
    const journaled = new Set(
      entries.map((entry) => `${entry.sourceType}:${entry.sourceId}`),
    );
    // Every posted, non-zero source must have its own JE — one missing is FAILED
    // even when others (e.g. the receipt JE) exist.
    const expected = [
      ...invoices
        .filter(
          (i) =>
            POSTED_STATUSES.has(i.status) &&
            Math.abs(Number(i.grandTotal)) >= 0.005,
        )
        .map((i) => `SALES_INVOICE:${i.id}`),
      ...receipts
        .filter((r) => POSTED_STATUSES.has(r.status))
        .map((r) => `${r.type}:${r.id}`),
      ...returns
        .filter((r) => POSTED_STATUSES.has(r.status))
        .map((r) => `SALES_RETURN:${r.id}`),
      ...refunds
        .filter((r) => POSTED_STATUSES.has(r.status ?? ''))
        .map((r) => `CUSTOMER_REFUND:${r.id}`),
    ];
    const journalMissing = expected.some((key) => !journaled.has(key));
    const journalState: TraceState = journalMissing
      ? 'FAILED'
      : entries.length > 0
        ? 'FOUND'
        : 'PENDING';

    // A verified payment on an invoiced order must have produced a receipt.
    const invoiced = invoices.some((i) => POSTED_STATUSES.has(i.status));
    const receiptNotes = new Set(receipts.map((r) => r.notes));
    const receiptMissing =
      invoiced &&
      payments.some(
        (p) =>
          p.status === 'VERIFIED' &&
          !receiptNotes.has(`${STORE_ORDER_PAYMENT_NOTE_PREFIX}${p.id}`),
      );
    const paymentItems: TraceRecord[] = [
      ...payments.map((p) => ({
        kind: 'PAYMENT' as const,
        id: p.id,
        number: p.paymentNumber,
        status: p.status,
      })),
      ...receipts.map((r) => ({
        kind: r.type,
        id: r.id,
        number: r.transactionNumber,
        status: r.status,
      })),
    ];

    const { items: movementItems, ...movementBounds } =
      await this.movementsForReferences([
        ...invoiceIds.map((refId) => ({ types: ['SALES_INVOICE'], id: refId })),
        ...returnIds.map((refId) => ({ types: ['SALES_RETURN'], id: refId })),
      ]);

    return {
      record: {
        kind: 'STORE_ORDER' as const,
        id: order.id,
        number: order.internalOrderId,
        status: order.paymentStatus,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          invoices.map((i) => ({
            kind: 'SALES_INVOICE' as const,
            id: i.id,
            number: i.invoiceNumber,
            status: i.status,
          })),
          'PENDING',
        ),
        {
          key: 'PAYMENTS' as const,
          state: receiptMissing
            ? ('FAILED' as const)
            : paymentItems.length > 0
              ? ('FOUND' as const)
              : ('PENDING' as const),
          items: paymentItems,
        },
        {
          key: 'JOURNAL_ENTRIES' as const,
          state: journalState,
          items: entries.map(withoutSource),
        },
        this.group(
          'SHIPMENTS',
          shipments.map((s) => ({
            kind: 'SHIPMENT' as const,
            id: s.id,
            number: shipmentNumber(s.attemptNumber, s.trackingNumber),
            status: s.status,
          })),
          'PENDING',
        ),
        {
          ...this.group(
            'STOCK_MOVEMENTS',
            movementItems,
            invoiced ? 'NONE' : 'PENDING',
          ),
          ...movementBounds,
        },
        this.group(
          'RETURNS',
          [
            ...returns.map((r) => ({
              kind: 'SALES_RETURN' as const,
              id: r.id,
              number: r.returnNumber,
              status: r.status,
            })),
            ...refunds,
          ],
          'NONE',
        ),
      ],
    };
  }

  private async shipment(id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        attemptNumber: true,
        trackingNumber: true,
        status: true,
        storeOrder: {
          select: { id: true, internalOrderId: true, paymentStatus: true },
        },
      },
    });
    if (!shipment) return null;
    return {
      record: {
        kind: 'SHIPMENT' as const,
        id: shipment.id,
        number: shipmentNumber(shipment.attemptNumber, shipment.trackingNumber),
        status: shipment.status,
      },
      groups: [
        this.group(
          'SOURCE',
          shipment.storeOrder
            ? [
                {
                  kind: 'STORE_ORDER' as const,
                  id: shipment.storeOrder.id,
                  number: shipment.storeOrder.internalOrderId,
                  status: shipment.storeOrder.paymentStatus,
                },
              ]
            : [],
        ),
      ],
    };
  }

  private async payment(id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        paymentNumber: true,
        status: true,
        storeOrder: {
          select: { id: true, internalOrderId: true, paymentStatus: true },
        },
      },
    });
    if (!payment) return null;
    const receipt = await this.prisma.financialTransaction.findFirst({
      where: {
        notes: `${STORE_ORDER_PAYMENT_NOTE_PREFIX}${id}`,
        deletedAt: null,
      },
      select: { id: true, transactionNumber: true, status: true, type: true },
    });
    const invoiced = payment.storeOrder
      ? await this.prisma.salesInvoice.count({
          where: {
            storeOrderId: payment.storeOrder.id,
            deletedAt: null,
            status: { in: ['CONFIRMED', 'CLOSED'] },
          },
        })
      : 0;
    const receiptState: TraceState =
      payment.status !== 'VERIFIED'
        ? 'PENDING'
        : invoiced > 0
          ? 'FAILED'
          : 'PENDING';
    return {
      record: {
        kind: 'PAYMENT' as const,
        id: payment.id,
        number: payment.paymentNumber,
        status: payment.status,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          payment.storeOrder
            ? [
                {
                  kind: 'STORE_ORDER' as const,
                  id: payment.storeOrder.id,
                  number: payment.storeOrder.internalOrderId,
                  status: payment.storeOrder.paymentStatus,
                },
              ]
            : [],
        ),
        receipt
          ? this.group('PAYMENTS', [
              {
                kind: receipt.type,
                id: receipt.id,
                number: receipt.transactionNumber,
                status: receipt.status,
              },
            ])
          : { key: 'PAYMENTS' as const, state: receiptState, items: [] },
        receipt
          ? await this.journalGroup(
              [receipt.type],
              [receipt.id],
              receipt.status,
            )
          : { key: 'JOURNAL_ENTRIES' as const, state: receiptState, items: [] },
      ],
    };
  }

  // ---- Reverse direction: JE / movement → source -------------------------------

  private async sourceRecord(
    kind: TraceKind,
    id: string,
  ): Promise<TraceRecord | null> {
    const graph = await this.load(kind, id);
    return graph?.record ?? null;
  }

  private async journalEntry(id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        entryNumber: true,
        status: true,
        sourceType: true,
        sourceId: true,
        reversalOfEntryId: true,
      },
    });
    if (!entry) return null;
    let source: TraceRecord | null = null;
    if (entry.sourceType && entry.sourceId) {
      source = await this.resolveJournalSource(
        entry.sourceType,
        entry.sourceId,
      );
    }
    const related = await this.prisma.journalEntry.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(entry.reversalOfEntryId ? [{ id: entry.reversalOfEntryId }] : []),
          { reversalOfEntryId: id },
        ],
      },
      select: { id: true, entryNumber: true, status: true, sourceType: true },
    });
    const isManual = !entry.sourceType || entry.sourceType === 'MANUAL';
    return {
      record: {
        kind: 'JOURNAL_ENTRY' as const,
        id: entry.id,
        number: entry.entryNumber,
        status: entry.status,
        sourceType: entry.sourceType,
      },
      groups: [
        source
          ? this.group('SOURCE', [{ ...source, sourceType: entry.sourceType }])
          : {
              key: 'SOURCE' as const,
              state: (isManual ? 'NOT_APPLICABLE' : 'FAILED') as TraceState,
              items: [],
            },
        this.group(
          'JOURNAL_ENTRIES',
          related.map((row) => ({
            kind: 'JOURNAL_ENTRY' as const,
            id: row.id,
            number: row.entryNumber,
            status: row.status,
            sourceType: row.sourceType,
          })),
        ),
      ],
    };
  }

  /** Schedule-row sources (a depreciation period / prepaid recognition)
   *  resolve to the asset/prepayment that owns the schedule. */
  private async resolveJournalSource(
    sourceType: string,
    sourceId: string,
  ): Promise<TraceRecord | null> {
    if (sourceType === 'FIXED_ASSET_DEPRECIATION') {
      const period = await this.prisma.fixedAssetDepreciationPeriod.findUnique({
        where: { id: sourceId },
        select: { fixedAssetId: true },
      });
      return period
        ? this.sourceRecord('FIXED_ASSET', period.fixedAssetId)
        : null;
    }
    if (sourceType === 'PREPAID_RECOGNITION') {
      const row = await this.prisma.prepaidRecognition.findUnique({
        where: { id: sourceId },
        select: { prepaidExpenseId: true },
      });
      return row
        ? this.sourceRecord('PREPAID_EXPENSE', row.prepaidExpenseId)
        : null;
    }
    const kind = JOURNAL_SOURCE_KIND[sourceType];
    if (!kind) return null;
    return this.sourceRecord(kind, sourceId);
  }

  private async inventoryMovement(id: string) {
    const movement = await this.prisma.inventoryMovement.findFirst({
      where: { id },
      select: {
        id: true,
        movementNumber: true,
        type: true,
        referenceType: true,
        referenceId: true,
      },
    });
    if (!movement) return null;
    const kind = movement.referenceType
      ? MOVEMENT_REFERENCE_KIND[movement.referenceType]
      : undefined;
    const source =
      kind && movement.referenceId
        ? await this.sourceRecord(kind, movement.referenceId)
        : null;
    const ownEntries = await this.journalEntriesFor(
      ['INVENTORY_ADJUSTMENT'],
      [id],
    );
    return {
      record: {
        kind: 'INVENTORY_MOVEMENT' as const,
        id: movement.id,
        number: movement.movementNumber,
        status: movement.type,
      },
      groups: [
        this.group(
          'SOURCE',
          source ? [source] : [],
          movement.referenceType ? 'FAILED' : 'NOT_APPLICABLE',
        ),
        this.group('JOURNAL_ENTRIES', ownEntries),
      ],
    };
  }

  // ---- Assets / prepayments ------------------------------------------------------

  private async fixedAsset(id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        purchaseInvoice: {
          select: { id: true, invoiceNumber: true, status: true },
        },
        depreciationPeriods: { select: { id: true } },
      },
    });
    if (!asset) return null;
    const entries = await this.journalEntriesFor(
      [
        'FIXED_ASSET_CAPITALIZATION',
        'FIXED_ASSET_DISPOSAL',
        'FIXED_ASSET_DEPRECIATION',
      ],
      [id, ...asset.depreciationPeriods.map((period) => period.id)],
    );
    return {
      record: {
        kind: 'FIXED_ASSET' as const,
        id: asset.id,
        number: asset.code ?? asset.name,
        status: asset.status,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          asset.purchaseInvoice
            ? [
                {
                  kind: 'PURCHASE_INVOICE' as const,
                  id: asset.purchaseInvoice.id,
                  number: asset.purchaseInvoice.invoiceNumber,
                  status: asset.purchaseInvoice.status,
                },
              ]
            : [],
        ),
        this.group(
          'JOURNAL_ENTRIES',
          entries,
          POSTED_STATUSES.has(asset.status) ? 'FAILED' : 'PENDING',
        ),
      ],
    };
  }

  private async prepaidExpense(id: string) {
    const prepaid = await this.prisma.prepaidExpense.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        prepaidNumber: true,
        status: true,
        purchaseInvoice: {
          select: { id: true, invoiceNumber: true, status: true },
        },
        recognitions: { select: { id: true } },
      },
    });
    if (!prepaid) return null;
    const entries = await this.journalEntriesFor(
      ['PREPAID_EXPENSE', 'PREPAID_RECOGNITION'],
      [id, ...prepaid.recognitions.map((row) => row.id)],
    );
    return {
      record: {
        kind: 'PREPAID_EXPENSE' as const,
        id: prepaid.id,
        number: prepaid.prepaidNumber,
        status: prepaid.status,
      },
      groups: [
        this.group(
          'DOCUMENTS',
          prepaid.purchaseInvoice
            ? [
                {
                  kind: 'PURCHASE_INVOICE' as const,
                  id: prepaid.purchaseInvoice.id,
                  number: prepaid.purchaseInvoice.invoiceNumber,
                  status: prepaid.purchaseInvoice.status,
                },
              ]
            : [],
        ),
        this.group(
          'JOURNAL_ENTRIES',
          entries,
          POSTED_STATUSES.has(prepaid.status) ? 'FAILED' : 'PENDING',
        ),
      ],
    };
  }
}
