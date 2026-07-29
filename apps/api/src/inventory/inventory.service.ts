import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InventoryMovementType, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  InventoryMovementActivityService,
  InventoryMovementActivityType,
} from './activities/inventory-movement-activity.service';
import { OpeningBalanceDto } from './dto/opening-balance.dto';
import { AdjustmentDto } from './dto/adjustment.dto';
import { TransferDto } from './dto/transfer.dto';
import { DamageDto } from './dto/damage.dto';
import { ExpiredDto } from './dto/expired.dto';
import { ReserveDto } from './dto/reserve.dto';
import { ReleaseDto } from './dto/release.dto';
import { FindMovementsQueryDto } from './dto/find-movements-query.dto';
import { BaseQuantityMovementDto } from './dto/base-quantity-movement.dto';

const RESERVATION_TYPES: InventoryMovementType[] = [
  InventoryMovementType.RESERVATION,
  InventoryMovementType.RESERVATION_RELEASE,
];

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
    private readonly activityService: InventoryMovementActivityService,
  ) {}

  async openingBalance(dto: OpeningBalanceDto) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const quantityBefore = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore + dto.quantity;

      const movement = await this.createMovement(tx, {
        movementNumber: await this.generateMovementNumber(tx),
        type: InventoryMovementType.OPENING_BALANCE,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore,
        quantityAfter,
        notes: dto.notes,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.OPENING_BALANCE_CREATED,
        `Opening balance of ${dto.quantity} set for ${product.sku} at ${warehouse.code}`,
        undefined,
        tx,
      );

      return movement;
    });
  }

  async adjustment(dto: AdjustmentDto) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const quantityBefore = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore + dto.quantity;

      if (quantityAfter < 0) {
        throw new BadRequestException(
          'Adjustment would result in negative stock.',
        );
      }

      const movement = await this.createMovement(tx, {
        movementNumber: await this.generateMovementNumber(tx),
        type: InventoryMovementType.ADJUSTMENT,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore,
        quantityAfter,
        notes: dto.notes,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.STOCK_ADJUSTED,
        `Stock adjusted by ${dto.quantity} for ${product.sku} at ${warehouse.code}`,
        undefined,
        tx,
      );

      return movement;
    });
  }

  async transfer(dto: TransferDto) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('Cannot transfer to the same warehouse.');
    }

    const product = await this.assertInventoryProduct(dto.productId);
    const sourceWarehouse = await this.assertActiveWarehouse(
      dto.sourceWarehouseId,
    );
    const destinationWarehouse = await this.assertActiveWarehouse(
      dto.destinationWarehouseId,
    );

    return this.prisma.$transaction(async (tx) => {
      const sourceQuantityBefore = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.sourceWarehouseId,
      );
      const sourceQuantityAfter = sourceQuantityBefore - dto.quantity;

      if (sourceQuantityAfter < 0) {
        throw new BadRequestException(
          'Insufficient stock at source warehouse for transfer.',
        );
      }

      const destinationQuantityBefore = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.destinationWarehouseId,
      );
      const destinationQuantityAfter = destinationQuantityBefore + dto.quantity;

      const transferId = randomUUID();

      const outMovement = await this.createMovement(tx, {
        movementNumber: await this.generateMovementNumber(tx),
        type: InventoryMovementType.TRANSFER,
        productId: dto.productId,
        warehouseId: dto.sourceWarehouseId,
        quantity: -dto.quantity,
        quantityBefore: sourceQuantityBefore,
        quantityAfter: sourceQuantityAfter,
        referenceType: 'TRANSFER',
        referenceId: transferId,
        notes: dto.notes,
      });

      const inMovement = await this.createMovement(tx, {
        movementNumber: await this.generateMovementNumber(tx),
        type: InventoryMovementType.TRANSFER,
        productId: dto.productId,
        warehouseId: dto.destinationWarehouseId,
        quantity: dto.quantity,
        quantityBefore: destinationQuantityBefore,
        quantityAfter: destinationQuantityAfter,
        referenceType: 'TRANSFER',
        referenceId: transferId,
        notes: dto.notes,
      });

      await this.activityService.log(
        outMovement.id,
        InventoryMovementActivityType.TRANSFERRED,
        `Transferred ${dto.quantity} of ${product.sku} out to ${destinationWarehouse.code}`,
        undefined,
        tx,
      );
      await this.activityService.log(
        inMovement.id,
        InventoryMovementActivityType.TRANSFERRED,
        `Transferred ${dto.quantity} of ${product.sku} in from ${sourceWarehouse.code}`,
        undefined,
        tx,
      );

      return { out: outMovement, in: inMovement };
    });
  }

  damage(dto: DamageDto) {
    return this.decreaseQuantity(
      dto,
      InventoryMovementType.DAMAGE,
      InventoryMovementActivityType.DAMAGED,
      'Damaged',
    );
  }

  expired(dto: ExpiredDto) {
    return this.decreaseQuantity(
      dto,
      InventoryMovementType.EXPIRED,
      InventoryMovementActivityType.EXPIRED,
      'Expired',
    );
  }

  async reserve(dto: ReserveDto) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const onHand = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const reserved = await this.getReservedQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const available = onHand - reserved;

      if (dto.quantity > available) {
        throw new BadRequestException(
          'Reservation quantity exceeds available stock.',
        );
      }

      const movement = await this.createMovement(tx, {
        movementNumber: await this.generateMovementNumber(tx),
        type: InventoryMovementType.RESERVATION,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore: onHand,
        quantityAfter: onHand,
        notes: dto.notes,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.RESERVED,
        `Reserved ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        tx,
      );

      return movement;
    });
  }

  async release(dto: ReleaseDto) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const onHand = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const reserved = await this.getReservedQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );

      if (dto.quantity > reserved) {
        throw new BadRequestException(
          'Release quantity exceeds reserved stock.',
        );
      }

      const movement = await this.createMovement(tx, {
        movementNumber: await this.generateMovementNumber(tx),
        type: InventoryMovementType.RESERVATION_RELEASE,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: -dto.quantity,
        quantityBefore: onHand,
        quantityAfter: onHand,
        notes: dto.notes,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.RESERVATION_RELEASED,
        `Released reservation of ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        tx,
      );

      return movement;
    });
  }

  findAllMovements(query: FindMovementsQueryDto) {
    return this.prisma.inventoryMovement.findMany({
      where: {
        productId: query.productId,
        warehouseId: query.warehouseId,
        type: query.type,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneMovement(id: string) {
    const movement = await this.prisma.inventoryMovement.findFirst({
      where: { id },
    });
    if (!movement) {
      throw new NotFoundException(`Inventory movement ${id} not found`);
    }
    return movement;
  }

  async getStock(productId: string, warehouseId?: string) {
    await this.productsService.findOne(productId);
    if (warehouseId) {
      await this.warehousesService.findOne(warehouseId);
    }

    const onHand = await this.getOnHandQuantity(
      this.prisma,
      productId,
      warehouseId,
    );
    const reserved = await this.getReservedQuantity(
      this.prisma,
      productId,
      warehouseId,
    );

    return {
      productId,
      warehouseId: warehouseId ?? null,
      onHand,
      reserved,
      available: onHand - reserved,
    };
  }

  private async decreaseQuantity(
    dto: BaseQuantityMovementDto,
    type: InventoryMovementType,
    activityType: string,
    label: string,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const quantityBefore = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore - dto.quantity;

      if (quantityAfter < 0) {
        throw new BadRequestException(
          `${label} quantity exceeds on-hand stock.`,
        );
      }

      const movement = await this.createMovement(tx, {
        movementNumber: await this.generateMovementNumber(tx),
        type,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: -dto.quantity,
        quantityBefore,
        quantityAfter,
        notes: dto.notes,
      });

      await this.activityService.log(
        movement.id,
        activityType,
        `${label} ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        tx,
      );

      return movement;
    });
  }

  /** "Inventory products only. Service and Digital products must not generate stock." */
  private async assertInventoryProduct(productId: string) {
    const product = await this.productsService.findOne(productId);
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('Product is inactive.');
    }
    if (!product.isInventoryItem) {
      throw new BadRequestException('Product is not an inventory item.');
    }
    return product;
  }

  private async assertActiveWarehouse(warehouseId: string) {
    const warehouse = await this.warehousesService.findOne(warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException('Warehouse is inactive.');
    }
    return warehouse;
  }

  private createMovement(
    tx: Prisma.TransactionClient,
    data: Prisma.InventoryMovementUncheckedCreateInput,
  ) {
    return tx.inventoryMovement.create({ data });
  }

  private async generateMovementNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('inventory_movement_number_seq')`;
    return `MV-${result[0].nextval.toString().padStart(6, '0')}`;
  }

  /** On-hand quantity: excludes the reserved ledger (RESERVATION/RESERVATION_RELEASE). */
  private async getOnHandQuantity(
    tx: Prisma.TransactionClient | PrismaService,
    productId: string,
    warehouseId?: string,
  ): Promise<number> {
    const result = await tx.inventoryMovement.aggregate({
      where: {
        productId,
        warehouseId,
        type: { notIn: RESERVATION_TYPES },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  /** Reserved ledger only: RESERVATION (+) and RESERVATION_RELEASE (-). */
  private async getReservedQuantity(
    tx: Prisma.TransactionClient | PrismaService,
    productId: string,
    warehouseId?: string,
  ): Promise<number> {
    const result = await tx.inventoryMovement.aggregate({
      where: {
        productId,
        warehouseId,
        type: { in: RESERVATION_TYPES },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }
}
