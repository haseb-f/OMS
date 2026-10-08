import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ReturnItemCondition,
  SalesDocumentStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { SalesReturnsService } from '../../sales/returns/sales-returns.service';
import { SalesReturnActivityType } from '../../sales/returns/activities/sales-return-activity.service';
import { lockStoreOrderRow } from '../store-order-payment-settlement.util';
import {
  POSTED_SALES_STATUSES,
  storeOrderReturnsWhere,
} from '../../financial-transactions/shared/store-order-money';
import type {
  ReceiveStoreOrderReturnDto,
  RequestStoreOrderReturnDto,
} from './dto/store-order-return.dto';

const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

/** A return raised but not received yet (no stock, no posting) — "Requested". */
const REQUESTED_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.DRAFT,
  SalesDocumentStatus.PENDING_APPROVAL,
  SalesDocumentStatus.APPROVED,
];

const RETURN_SELECT = {
  id: true,
  returnNumber: true,
  status: true,
  reason: true,
  grandTotal: true,
  salesInvoiceId: true,
  createdAt: true,
  confirmedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      condition: true,
      lineTotal: true,
      salesInvoiceItemId: true,
      product: { select: { sku: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true, role: true } },
    },
  },
} satisfies Prisma.SalesReturnSelect;

/**
 * R15 (D15-10) — returns of a store order's delivered goods, from the order:
 * "Return" requests them (a DRAFT credit note per delivered invoice, reason
 * required, no stock effect); "Receive & inspect" is the physical receipt —
 * per line SALEABLE back to stock or DAMAGED to the damaged-goods warehouse —
 * which restocks and posts the credit note through the existing Sales Return
 * confirm (the Posting Engine reverses revenue and COGS at the invoice
 * snapshot cost). Works the same for prepaid and COD orders, whatever their
 * payment status (D15-3). Agent-owned goods never come back this way: agent
 * returns use the agent flow. Every route is gated by the order's by-id
 * sales scope (404, never 403).
 */
@Injectable()
export class StoreOrderReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly returns: SalesReturnsService,
    private readonly salesScope: SalesScopeService,
  ) {}

  /** The order's delivered (invoiced) lines with what can still be returned, and its returns. */
  async overview(storeOrderId: string, userId: string) {
    await this.salesScope.assertCanOpenStoreOrder(userId, storeOrderId);
    const order = await this.prisma.storeOrder.findUniqueOrThrow({
      where: { id: storeOrderId },
      select: { id: true, agentId: true, recognitionStatus: true },
    });
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        storeOrderId,
        deletedAt: null,
        status: { in: POSTED_SALES_STATUSES },
      },
      select: {
        id: true,
        invoiceNumber: true,
        shipmentId: true,
        createdAt: true,
        items: {
          where: { deletedAt: null },
          select: {
            id: true,
            productId: true,
            quantity: true,
            lineTotal: true,
            product: { select: { sku: true, name: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { invoiceNumber: 'asc' }],
    });
    const lineIds = invoices.flatMap((invoice) =>
      invoice.items.map((item) => item.id),
    );
    const returned = lineIds.length
      ? await this.prisma.salesReturnItem.groupBy({
          by: ['salesInvoiceItemId'],
          where: {
            salesInvoiceItemId: { in: lineIds },
            salesReturn: {
              deletedAt: null,
              status: { not: SalesDocumentStatus.CANCELLED },
            },
          },
          _sum: { quantity: true },
        })
      : [];
    const returnedByLine = new Map(
      returned.map((row) => [row.salesInvoiceItemId, row._sum.quantity ?? 0]),
    );
    const returns = await this.prisma.salesReturn.findMany({
      where: storeOrderReturnsWhere(storeOrderId),
      select: RETURN_SELECT,
      orderBy: [{ createdAt: 'asc' }, { returnNumber: 'asc' }],
    });
    return {
      storeOrderId: order.id,
      isAgentOrder: order.agentId !== null,
      recognitionStatus: order.recognitionStatus,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        shipmentId: invoice.shipmentId,
        lines: invoice.items.map((item) => {
          const returnedQuantity = returnedByLine.get(item.id) ?? 0;
          return {
            salesInvoiceItemId: item.id,
            productId: item.productId,
            sku: item.product.sku,
            name: item.product.name,
            invoicedQuantity: item.quantity,
            returnedQuantity,
            returnableQuantity: Math.max(item.quantity - returnedQuantity, 0),
            lineTotal: Number(item.lineTotal).toFixed(2),
          };
        }),
      })),
      returns: returns.map((row) => ({
        ...row,
        grandTotal: Number(row.grandTotal).toFixed(2),
        requested: REQUESTED_STATUSES.includes(row.status),
        items: row.items.map((item) => ({
          ...item,
          lineTotal: Number(item.lineTotal).toFixed(2),
        })),
      })),
    };
  }

  /**
   * "Return": one DRAFT return per delivered invoice the lines belong to
   * (a return references exactly one invoice), in one transaction under the
   * order row lock. A retried submit with the same key returns the first
   * request's returns.
   */
  async request(
    storeOrderId: string,
    dto: RequestStoreOrderReturnDto,
    userId: string,
  ) {
    await this.salesScope.assertCanOpenStoreOrder(userId, storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      await lockStoreOrderRow(tx, storeOrderId);
      const replayed = await tx.salesReturnActivity.findMany({
        where: {
          type: SalesReturnActivityType.RETURN_CREATED,
          metadata: { path: ['idempotencyKey'], equals: dto.idempotencyKey },
          salesReturn: { storeOrderId },
        },
        select: { salesReturnId: true },
      });
      if (replayed.length > 0) {
        return {
          replayed: true,
          returns: await tx.salesReturn.findMany({
            where: { id: { in: replayed.map((row) => row.salesReturnId) } },
            select: RETURN_SELECT,
          }),
        };
      }
      const order = await tx.storeOrder.findUniqueOrThrow({
        where: { id: storeOrderId },
        select: { internalOrderId: true, agentId: true },
      });
      if (order.agentId) {
        throw new UnprocessableEntityException({
          code: 'AGENT_ORDER_USE_AGENT_RETURN',
          message:
            'بضاعة الوكيل تُرتجع من مسار مرتجعات الوكيل — Agent-owned goods are returned through the agent return flow (Agent order → Returns), never as a company sales return.',
        });
      }
      const lineIds = dto.lines.map((line) => line.salesInvoiceItemId);
      const invoiceLines = await tx.salesInvoiceItem.findMany({
        where: {
          id: { in: lineIds },
          deletedAt: null,
          salesInvoice: {
            storeOrderId,
            deletedAt: null,
            status: { in: POSTED_SALES_STATUSES },
          },
        },
        select: { id: true, salesInvoiceId: true },
      });
      const invoiceOf = new Map(
        invoiceLines.map((line) => [line.id, line.salesInvoiceId]),
      );
      const byInvoice = new Map<string, RequestStoreOrderReturnDto['lines']>();
      for (const line of dto.lines) {
        const invoiceId = invoiceOf.get(line.salesInvoiceItemId);
        if (!invoiceId) {
          throw new BadRequestException(
            `السطر ليس من بضاعة مُسلّمة لهذا الطلب — Line ${line.salesInvoiceItemId} is not a delivered (invoiced) line of order ${order.internalOrderId}.`,
          );
        }
        byInvoice.set(invoiceId, [...(byInvoice.get(invoiceId) ?? []), line]);
      }
      const created: Array<{ id: string; returnNumber: string }> = [];
      for (const [salesInvoiceId, lines] of byInvoice) {
        created.push(
          await this.returns.createFromInvoiceLines(
            tx,
            {
              salesInvoiceId,
              storeOrderId,
              reason: dto.reason,
              lines,
              idempotencyKey: dto.idempotencyKey,
            },
            userId,
          ),
        );
      }
      await tx.storeOrderActivity.create({
        data: {
          storeOrderId,
          action: 'RETURN_REQUESTED',
          details: `Return requested (${created.map((row) => row.returnNumber).join(', ')}): ${dto.reason} — no stock moves until the goods are received and inspected`,
          performedById: userId,
        },
      });
      return {
        replayed: false,
        returns: await tx.salesReturn.findMany({
          where: { id: { in: created.map((row) => row.id) } },
          select: RETURN_SELECT,
        }),
      };
    }, TX_OPTIONS);
  }

  /** "Receive & inspect" one requested return of the order (idempotent once received). */
  async receive(
    storeOrderId: string,
    salesReturnId: string,
    dto: ReceiveStoreOrderReturnDto,
    userId: string,
  ) {
    await this.salesScope.assertCanOpenStoreOrder(userId, storeOrderId);
    return this.prisma.$transaction(async (tx) => {
      await lockStoreOrderRow(tx, storeOrderId);
      const target = await tx.salesReturn.findFirst({
        where: { id: salesReturnId, ...storeOrderReturnsWhere(storeOrderId) },
        select: { status: true },
      });
      if (!target) throw new NotFoundException('Sales Return not found');
      const alreadyReceived = POSTED_SALES_STATUSES.includes(target.status);
      const received = await this.returns.receiveInTx(
        tx,
        salesReturnId,
        dto.lines ?? [],
        userId,
      );
      if (!alreadyReceived) {
        const damaged = received.items.filter(
          (item) => item.condition === ReturnItemCondition.DAMAGED,
        ).length;
        await tx.storeOrderActivity.create({
          data: {
            storeOrderId,
            action: 'RETURN_RECEIVED',
            details: `Sales Return ${received.returnNumber} received and inspected: ${received.items.length - damaged} line(s) saleable back to stock, ${damaged} damaged to the damaged-goods warehouse — credit note posted (revenue and cost of goods reversed)`,
            performedById: userId,
          },
        });
      }
      return tx.salesReturn.findUniqueOrThrow({
        where: { id: salesReturnId },
        select: RETURN_SELECT,
      });
    }, TX_OPTIONS);
  }
}
