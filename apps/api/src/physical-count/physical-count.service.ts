import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  PhysicalCountStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { InventoryService } from '../inventory/inventory.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  InventoryMovementActivityService,
  InventoryMovementActivityType,
} from '../inventory/activities/inventory-movement-activity.service';
import { CreatePhysicalCountDto } from './dto/create-physical-count.dto';
import { UpdateCountLineDto } from './dto/update-count-line.dto';

const DOCUMENT_TYPE = 'INVENTORY_COUNT';

/**
 * Physical Inventory Count (TASK-029) — a counting document with one line
 * per product, snapshotting the system on-hand quantity at creation time.
 * The user enters what they physically counted; confirming compares the two
 * and generates a real PHYSICAL_COUNT movement for every line with a
 * non-zero difference (ADR-0013: stock quantity is never edited directly,
 * only ever moved via a movement row).
 */
@Injectable()
export class PhysicalCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly inventoryService: InventoryService,
    private readonly warehousesService: WarehousesService,
    private readonly activityService: InventoryMovementActivityService,
  ) {}

  async create(dto: CreatePhysicalCountDto, userId?: string) {
    const warehouse = await this.warehousesService.findOne(dto.warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException('Warehouse is inactive.');
    }

    const products = dto.productIds?.length
      ? await this.prisma.product.findMany({
          where: {
            id: { in: dto.productIds },
            isInventoryItem: true,
            status: ProductStatus.ACTIVE,
            deletedAt: null,
          },
        })
      : await this.prisma.product.findMany({
          where: {
            isInventoryItem: true,
            status: ProductStatus.ACTIVE,
            deletedAt: null,
          },
          orderBy: { name: 'asc' },
        });

    if (products.length === 0) {
      throw new BadRequestException(
        'No active inventory products found to count.',
      );
    }

    const countNumber =
      await this.numberingEngine.generateNumber(DOCUMENT_TYPE);

    const snapshots = await Promise.all(
      products.map(async (product) => ({
        productId: product.id,
        systemQuantity: (
          await this.inventoryService.getStock(product.id, dto.warehouseId)
        ).onHand,
      })),
    );

    return this.prisma.physicalCount.create({
      data: {
        countNumber,
        warehouseId: dto.warehouseId,
        notes: dto.notes,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        lines: {
          create: snapshots.map((snapshot) => ({
            productId: snapshot.productId,
            systemQuantity: snapshot.systemQuantity,
          })),
        },
      },
      include: this.detailInclude(),
    });
  }

  findAll() {
    return this.prisma.physicalCount.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        warehouse: { select: { code: true, name: true } },
        _count: { select: { lines: true } },
      },
    });
  }

  async findOne(id: string) {
    const count = await this.prisma.physicalCount.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!count) {
      throw new NotFoundException(`Physical count ${id} not found`);
    }
    return count;
  }

  async updateLine(
    countId: string,
    lineId: string,
    dto: UpdateCountLineDto,
    userId?: string,
  ) {
    const count = await this.findOne(countId);
    if (count.status !== PhysicalCountStatus.DRAFT) {
      throw new BadRequestException(
        'Only a Draft count can have its lines updated.',
      );
    }
    const line = count.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException(`Count line ${lineId} not found`);
    }

    await this.prisma.physicalCountLine.update({
      where: { id: lineId },
      data: { countedQuantity: dto.countedQuantity },
    });
    await this.prisma.physicalCount.update({
      where: { id: countId },
      data: { updatedBy: userId ?? null },
    });

    return this.findOne(countId);
  }

  /**
   * Applies each line's (counted − system) difference to CURRENT on-hand
   * quantity — not the frozen snapshot — so the resulting movement's
   * before/after stays a true ledger reading even if other movements
   * happened between count creation and confirm. A line whose counted
   * quantity is still unset, or matches the system quantity exactly,
   * generates no movement.
   */
  async confirm(id: string, userId?: string) {
    const count = await this.findOne(id);
    if (count.status !== PhysicalCountStatus.DRAFT) {
      throw new BadRequestException('Only a Draft count can be confirmed.');
    }
    const uncounted = count.lines.some((line) => line.countedQuantity === null);
    if (uncounted) {
      throw new BadRequestException(
        'Every line must have a counted quantity before confirming.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < count.lines.length; i++) {
        const line = count.lines[i];
        const difference = line.countedQuantity! - line.systemQuantity;
        if (difference === 0) continue;

        const quantityBefore = (
          await this.inventoryService.getStock(
            line.productId,
            count.warehouseId,
          )
        ).onHand;
        const quantityAfter = quantityBefore + difference;

        if (quantityAfter < 0) {
          throw new BadRequestException(
            `Confirming would result in negative stock for ${line.product.sku}.`,
          );
        }

        const movement = await tx.inventoryMovement.create({
          data: {
            movementNumber: `${count.countNumber}-${i + 1}`,
            type: InventoryMovementType.PHYSICAL_COUNT,
            productId: line.productId,
            warehouseId: count.warehouseId,
            quantity: difference,
            quantityBefore,
            quantityAfter,
            referenceType: 'PHYSICAL_COUNT',
            referenceId: count.id,
            reason: 'Physical Count',
            notes: count.notes,
            createdBy: userId ?? null,
          },
        });

        await this.activityService.log(
          movement.id,
          InventoryMovementActivityType.PHYSICAL_COUNT_ADJUSTED,
          `Physical count ${count.countNumber} adjusted ${line.product.sku} by ${difference}`,
          undefined,
          tx,
        );

        await tx.physicalCountLine.update({
          where: { id: line.id },
          data: { movementId: movement.id },
        });
      }

      return tx.physicalCount.update({
        where: { id },
        data: {
          status: PhysicalCountStatus.CONFIRMED,
          confirmedAt: new Date(),
          updatedBy: userId ?? null,
        },
        include: this.detailInclude(),
      });
    });
  }

  async cancel(id: string, userId?: string) {
    const count = await this.findOne(id);
    if (count.status !== PhysicalCountStatus.DRAFT) {
      throw new BadRequestException('Only a Draft count can be cancelled.');
    }
    return this.prisma.physicalCount.update({
      where: { id },
      data: {
        status: PhysicalCountStatus.CANCELLED,
        updatedBy: userId ?? null,
      },
      include: this.detailInclude(),
    });
  }

  private detailInclude() {
    return {
      warehouse: { select: { code: true, name: true } },
      lines: {
        include: {
          product: { select: { sku: true, name: true, displayName: true } },
          movement: { select: { id: true, movementNumber: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    } satisfies Prisma.PhysicalCountInclude;
  }
}
