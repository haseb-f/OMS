import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AGENT_STOCK_RECEIPT_REFERENCE } from '../../inventory/inventory.service';
import {
  STORE_ORDER_REFERENCE,
  STORE_ORDER_TRANSIT_REFERENCE,
} from '../../store-orders/stock-lifecycle/stock-ledger';
import { agentStockEvent } from './agent-stock-rules';
import { agentNotFoundError } from '../common/agent-errors';
import type { AgentStockMovementsQueryDto } from './dto/agent-stock.dto';

/** `referenceType` of an agent order return's SALES_RETURN movements (agent-fulfillment.service). */
const AGENT_RETURN_REFERENCE = 'AGENT_ORDER_RETURN';

export type AgentStockDocument =
  | { kind: 'AGENT_STOCK_RECEIPT'; id: string; number: string }
  | { kind: 'STORE_ORDER'; id: string; number: string }
  | {
      kind: 'AGENT_RETURN';
      id: string;
      number: string;
      storeOrderId: string;
    };

/**
 * R18 B — an agent's stock movement history: every movement whose owner
 * snapshot is the agent (never re-attributed), newest first, each linked to
 * the document that caused it — its receipt, its order (reservation,
 * dispatch to / back from goods in transit, delivery) or its return. Shared
 * by the internal agent page and the agent portal (scoped to the agent's own
 * id by the caller). No cost column is ever returned.
 */
@Injectable()
export class AgentStockHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async movements(agentId: string, query: AgentStockMovementsQueryDto) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId },
      select: { id: true },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { ownerAgentId: agentId, productId: query.productId };
    const [rows, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { movementNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          movementNumber: true,
          type: true,
          quantity: true,
          quantityAfter: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              nameEn: true,
              displayName: true,
            },
          },
          warehouse: {
            select: { id: true, code: true, name: true, role: true },
          },
        },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    const documents = await this.documents(agentId, rows);
    return {
      items: rows.map((row) => ({
        id: row.id,
        movementNumber: row.movementNumber,
        type: row.type,
        event: agentStockEvent({
          type: row.type,
          quantity: row.quantity,
          referenceType: row.referenceType,
          warehouseRole: row.warehouse.role,
        }),
        quantity: row.quantity,
        createdAt: row.createdAt,
        product: row.product,
        warehouse: row.warehouse,
        document: row.referenceId
          ? (documents.get(`${row.referenceType}:${row.referenceId}`) ?? null)
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** The source documents of a page of movements, read in one query per kind (scoped to the agent). */
  private async documents(
    agentId: string,
    rows: { referenceType: string | null; referenceId: string | null }[],
  ): Promise<Map<string, AgentStockDocument>> {
    const idsOf = (...types: string[]) => [
      ...new Set(
        rows
          .filter(
            (row) => row.referenceType && types.includes(row.referenceType),
          )
          .map((row) => row.referenceId)
          .filter((id): id is string => !!id),
      ),
    ];
    const receiptIds = idsOf(AGENT_STOCK_RECEIPT_REFERENCE);
    const orderIds = idsOf(
      STORE_ORDER_REFERENCE,
      STORE_ORDER_TRANSIT_REFERENCE,
    );
    const returnIds = idsOf(AGENT_RETURN_REFERENCE);
    const [receipts, orders, returns] = await Promise.all([
      receiptIds.length
        ? this.prisma.agentStockReceipt.findMany({
            where: { id: { in: receiptIds }, agentId },
            select: { id: true, receiptNumber: true },
          })
        : [],
      orderIds.length
        ? this.prisma.storeOrder.findMany({
            where: { id: { in: orderIds }, agentId },
            select: { id: true, internalOrderId: true },
          })
        : [],
      returnIds.length
        ? this.prisma.agentOrderReturn.findMany({
            where: { id: { in: returnIds }, agentId },
            select: { id: true, returnNumber: true, storeOrderId: true },
          })
        : [],
    ]);
    const map = new Map<string, AgentStockDocument>();
    for (const r of receipts) {
      map.set(`${AGENT_STOCK_RECEIPT_REFERENCE}:${r.id}`, {
        kind: 'AGENT_STOCK_RECEIPT',
        id: r.id,
        number: r.receiptNumber,
      });
    }
    for (const o of orders) {
      const doc = {
        kind: 'STORE_ORDER' as const,
        id: o.id,
        number: o.internalOrderId,
      };
      map.set(`${STORE_ORDER_REFERENCE}:${o.id}`, doc);
      map.set(`${STORE_ORDER_TRANSIT_REFERENCE}:${o.id}`, doc);
    }
    for (const r of returns) {
      map.set(`${AGENT_RETURN_REFERENCE}:${r.id}`, {
        kind: 'AGENT_RETURN',
        id: r.id,
        number: r.returnNumber,
        storeOrderId: r.storeOrderId,
      });
    }
    return map;
  }
}
