import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import {
  InventoryService,
  lockProductsForUpdate,
} from '../../inventory/inventory.service';
import { todayBusinessDate } from '../../common/time/business-date';
import {
  agentConflict,
  agentForbidden,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import {
  assertDistinctProducts,
  receiptBusinessDate,
} from './agent-stock-rules';
import type {
  CreateAgentStockReceiptDto,
  FindAgentStockReceiptsQueryDto,
} from './dto/agent-stock.dto';

/** Opening stock is its own Permission Matrix row ("Opening Inventory"). */
export const OPENING_STOCK_PERMISSION = 'inventory.opening-stock.create';

const RECEIPT_INCLUDE = {
  agent: { select: { id: true, agentNumber: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdByUser: { select: { fullName: true } },
  lines: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      productId: true,
      quantity: true,
      movementId: true,
      product: {
        select: { sku: true, name: true, nameEn: true, displayName: true },
      },
      movement: { select: { movementNumber: true, type: true } },
    },
  },
} satisfies Prisma.AgentStockReceiptInclude;

type ReceiptRow = Prisma.AgentStockReceiptGetPayload<{
  include: typeof RECEIPT_INCLUDE;
}>;

function present(receipt: ReceiptRow) {
  return {
    ...receipt,
    receiptDate: receipt.receiptDate.toISOString().slice(0, 10),
    totalQuantity: receipt.lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

/**
 * R18 B — agent stock receipts: the custody workflow for agent-owned goods
 * (opening stock and later receipts) on top of the Inventory Engine. Each line
 * is one non-valued movement posted by `InventoryService` (owner stamped from
 * the product); this service only owns the document, its number and its
 * validation. Nothing here reads or writes a cost, a payable or a journal.
 */
@Injectable()
export class AgentStockReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingEngineService,
    private readonly inventory: InventoryService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  async create(dto: CreateAgentStockReceiptDto, userId: string) {
    const key = dto.idempotencyKey.trim();
    const replay = await this.prisma.agentStockReceipt.findUnique({
      where: { idempotencyKey: key },
      include: RECEIPT_INCLUDE,
    });
    if (replay) {
      if (replay.agentId !== dto.agentId) {
        throw agentConflict(
          'IDEMPOTENCY_KEY_REUSED',
          'مفتاح منع التكرار مستخدم لوكيل آخر',
          'This idempotency key was used for another agent.',
        );
      }
      return { ...present(replay), replayed: true };
    }
    if (
      dto.kind === 'OPENING' &&
      !(await this.permissions.hasPermission(userId, OPENING_STOCK_PERMISSION))
    ) {
      throw agentForbidden(
        'OPENING_STOCK_PERMISSION_REQUIRED',
        'تسجيل الرصيد الافتتاحي يتطلب صلاحية «المخزون الافتتاحي»',
        'Recording opening stock needs the Opening Inventory permission.',
      );
    }
    assertDistinctProducts(dto.lines);
    const receiptDate = receiptBusinessDate(
      dto.receiptDate,
      todayBusinessDate(),
    );
    const agent = await this.prisma.agent.findFirst({
      where: { id: dto.agentId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    if (agent.status !== AgentStatus.ACTIVE) {
      throw agentUnprocessable(
        'AGENT_INACTIVE',
        'الوكيل غير نشط',
        'The agent is not active.',
      );
    }

    const receiptId = randomUUID();
    let created: ReceiptRow;
    try {
      created = await this.post(dto, key, receiptId, receiptDate, userId);
    } catch (error) {
      // A concurrent request with the same key won the race: answer with it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.agentStockReceipt.findUnique({
          where: { idempotencyKey: key },
          include: RECEIPT_INCLUDE,
        });
        if (winner?.agentId === dto.agentId) {
          return { ...present(winner), replayed: true };
        }
      }
      throw error;
    }
    return { ...present(created), replayed: false };
  }

  private post(
    dto: CreateAgentStockReceiptDto,
    key: string,
    receiptId: string,
    receiptDate: string,
    userId: string,
  ): Promise<ReceiptRow> {
    return this.prisma.$transaction(
      async (tx) => {
        await lockProductsForUpdate(
          tx,
          dto.lines.map((line) => line.productId),
        );
        const receiptNumber = await this.numbering.generateNumber(
          'AGENT_STOCK_RECEIPT',
          undefined,
          tx,
        );
        await tx.agentStockReceipt.create({
          data: {
            id: receiptId,
            receiptNumber,
            agentId: dto.agentId,
            warehouseId: dto.warehouseId,
            kind: dto.kind,
            receiptDate: new Date(`${receiptDate}T00:00:00.000Z`),
            reference: dto.reference?.trim() || null,
            notes: dto.notes?.trim() || null,
            idempotencyKey: key,
            createdBy: userId,
          },
        });
        const notes = [
          dto.reference?.trim() && `Ref ${dto.reference.trim()}`,
          dto.notes?.trim(),
        ]
          .filter(Boolean)
          .join(' — ');
        for (const line of dto.lines) {
          const movement = await this.inventory.postAgentStockReceiptLine(
            tx,
            {
              agentId: dto.agentId,
              receiptId,
              receiptNumber,
              kind: dto.kind,
              productId: line.productId,
              warehouseId: dto.warehouseId,
              quantity: line.quantity,
              notes: notes || null,
            },
            userId,
          );
          await tx.agentStockReceiptLine.create({
            data: {
              receiptId,
              productId: line.productId,
              quantity: line.quantity,
              movementId: movement.id,
            },
          });
        }
        return tx.agentStockReceipt.findUniqueOrThrow({
          where: { id: receiptId },
          include: RECEIPT_INCLUDE,
        });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  async list(query: FindAgentStockReceiptsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where: Prisma.AgentStockReceiptWhereInput = {
      agentId: query.agentId,
      id: query.receiptId,
      ...(search
        ? {
            OR: [
              { receiptNumber: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.agentStockReceipt.findMany({
        where,
        include: RECEIPT_INCLUDE,
        orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.agentStockReceipt.count({ where }),
    ]);
    return { items: rows.map(present), total, page, pageSize };
  }
}
