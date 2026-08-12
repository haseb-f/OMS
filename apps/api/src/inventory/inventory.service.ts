import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InventoryMovement,
  InventoryMovementType,
  InventoryValuationMethod,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { ProductsService } from '../products/products.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { ProductCostService } from '../product-cost/product-cost.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
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
import { PostSalesDeliveryDto } from './dto/post-sales-delivery.dto';
import { PostSalesReturnDto } from './dto/post-sales-return.dto';
import { PostPurchaseReceiptDto } from './dto/post-purchase-receipt.dto';
import { PostPurchaseReturnDto } from './dto/post-purchase-return.dto';

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
    private readonly numberingEngine: NumberingEngineService,
    private readonly productCostService: ProductCostService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async openingBalance(dto: OpeningBalanceDto, userId?: string) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const movement = await this.prisma.$transaction(async (tx) => {
      const quantityBefore = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore + dto.quantity;

      const movement = await this.createMovement(tx, {
        movementNumber: await this.numberingEngine.generateNumber(
          'OPENING_INVENTORY',
          undefined,
          tx,
        ),
        type: InventoryMovementType.OPENING_BALANCE,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore,
        quantityAfter,
        unitCost: dto.unitCost,
        notes: dto.notes,
        createdBy: userId ?? null,
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

    // Recorded as its own operation, after the movement commits (TASK-028
    // Part 6) — ProductCostService runs its own transaction internally, so
    // this stays a separate step rather than nesting inside the movement's
    // transaction. A failure here still leaves the opening-balance movement
    // in place; cost can be corrected afterward via the existing
    // POST /product-cost/:productId endpoint.
    if (dto.unitCost !== undefined) {
      await this.productCostService.recordCost(dto.productId, {
        cost: dto.unitCost,
        reason: 'Opening balance',
        referenceType: 'INVENTORY_MOVEMENT',
        referenceId: movement.id,
      });
    }

    return movement;
  }

  async adjustment(dto: AdjustmentDto, userId?: string) {
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
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_ADJUSTMENT',
          undefined,
          tx,
        ),
        type: InventoryMovementType.ADJUSTMENT,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore,
        quantityAfter,
        reason: dto.reason,
        notes: dto.notes,
        createdBy: userId ?? null,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.STOCK_ADJUSTED,
        `Stock adjusted by ${dto.quantity} for ${product.sku} at ${warehouse.code} (${dto.reason})`,
        undefined,
        tx,
      );

      await this.postingEngine.post(
        'INVENTORY_ADJUSTMENT',
        movement.id,
        userId,
        tx,
      );

      return movement;
    });
  }

  /**
   * TASK-029 — one Stock Transfer document can move several products in one
   * go. One document number is minted for the whole transfer; each line
   * gets its own OUT/IN movement pair, sharing that number (suffixed with a
   * line index when there's more than one line, and `-OUT`/`-IN` always, to
   * keep every `movementNumber` unique while the shared prefix still reads
   * as "one transfer document" in the ledger).
   */
  async transfer(dto: TransferDto, userId?: string) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('Cannot transfer to the same warehouse.');
    }

    const sourceWarehouse = await this.assertActiveWarehouse(
      dto.sourceWarehouseId,
    );
    const destinationWarehouse = await this.assertActiveWarehouse(
      dto.destinationWarehouseId,
    );
    const products = await Promise.all(
      dto.lines.map((line) => this.assertInventoryProduct(line.productId)),
    );

    return this.prisma.$transaction(async (tx) => {
      const transferId = randomUUID();
      const transferNumber = await this.numberingEngine.generateNumber(
        'WAREHOUSE_TRANSFER',
        undefined,
        tx,
      );
      const multiLine = dto.lines.length > 1;

      const lines: { out: InventoryMovement; in: InventoryMovement }[] = [];

      for (let i = 0; i < dto.lines.length; i++) {
        const line = dto.lines[i];
        const product = products[i];
        const suffix = multiLine ? `-${i + 1}` : '';

        const sourceQuantityBefore = await this.getOnHandQuantity(
          tx,
          line.productId,
          dto.sourceWarehouseId,
        );
        const sourceQuantityAfter = sourceQuantityBefore - line.quantity;

        if (sourceQuantityAfter < 0) {
          throw new BadRequestException(
            `Insufficient stock of ${product.sku} at source warehouse for transfer.`,
          );
        }

        const destinationQuantityBefore = await this.getOnHandQuantity(
          tx,
          line.productId,
          dto.destinationWarehouseId,
        );
        const destinationQuantityAfter =
          destinationQuantityBefore + line.quantity;

        const outMovement = await this.createMovement(tx, {
          movementNumber: `${transferNumber}${suffix}-OUT`,
          type: InventoryMovementType.TRANSFER,
          productId: line.productId,
          warehouseId: dto.sourceWarehouseId,
          quantity: -line.quantity,
          quantityBefore: sourceQuantityBefore,
          quantityAfter: sourceQuantityAfter,
          referenceType: 'TRANSFER',
          referenceId: transferId,
          notes: dto.notes,
          createdBy: userId ?? null,
        });

        const inMovement = await this.createMovement(tx, {
          movementNumber: `${transferNumber}${suffix}-IN`,
          type: InventoryMovementType.TRANSFER,
          productId: line.productId,
          warehouseId: dto.destinationWarehouseId,
          quantity: line.quantity,
          quantityBefore: destinationQuantityBefore,
          quantityAfter: destinationQuantityAfter,
          referenceType: 'TRANSFER',
          referenceId: transferId,
          notes: dto.notes,
          createdBy: userId ?? null,
        });

        await this.activityService.log(
          outMovement.id,
          InventoryMovementActivityType.TRANSFERRED,
          `Transferred ${line.quantity} of ${product.sku} out to ${destinationWarehouse.code}`,
          undefined,
          tx,
        );
        await this.activityService.log(
          inMovement.id,
          InventoryMovementActivityType.TRANSFERRED,
          `Transferred ${line.quantity} of ${product.sku} in from ${sourceWarehouse.code}`,
          undefined,
          tx,
        );

        lines.push({ out: outMovement, in: inMovement });
      }

      return { transferNumber, lines };
    });
  }

  damage(dto: DamageDto, userId?: string) {
    return this.decreaseQuantity(
      dto,
      InventoryMovementType.DAMAGE,
      InventoryMovementActivityType.DAMAGED,
      'Damaged',
      userId,
    );
  }

  expired(dto: ExpiredDto, userId?: string) {
    return this.decreaseQuantity(
      dto,
      InventoryMovementType.EXPIRED,
      InventoryMovementActivityType.EXPIRED,
      'Expired',
      userId,
    );
  }

  async reserve(dto: ReserveDto, userId?: string) {
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
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_MOVEMENT',
          undefined,
          tx,
        ),
        type: InventoryMovementType.RESERVATION,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore: onHand,
        quantityAfter: onHand,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        notes: dto.notes,
        createdBy: userId ?? null,
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

  /** Accepts an optional caller-supplied `tx` (TASK-057) — see `postPurchaseReceipt`'s doc comment for why. */
  async release(
    dto: ReleaseDto,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      const onHand = await this.getOnHandQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );
      const reserved = await this.getReservedQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );

      if (dto.quantity > reserved) {
        throw new BadRequestException(
          'Release quantity exceeds reserved stock.',
        );
      }

      const movement = await this.createMovement(client, {
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_MOVEMENT',
          undefined,
          client,
        ),
        type: InventoryMovementType.RESERVATION_RELEASE,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: -dto.quantity,
        quantityBefore: onHand,
        quantityAfter: onHand,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        notes: dto.notes,
        createdBy: userId ?? null,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.RESERVATION_RELEASED,
        `Released reservation of ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        client,
      );

      return movement;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Sales Foundation (TASK-037) — posted when a Sales Invoice is confirmed.
   * Modeled directly on the existing `decreaseQuantity` helper (which backs
   * Damage/Expired) but posts `SALES_DELIVERY` with a required source-
   * document reference, since a sale should always be traceable.
   */
  /** Accepts an optional caller-supplied `tx` (TASK-057) — see `postPurchaseReceipt`'s doc comment for why. */
  async postSalesDelivery(
    dto: PostSalesDeliveryDto,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      const quantityBefore = await this.getOnHandQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore - dto.quantity;

      if (quantityAfter < 0) {
        throw new BadRequestException(
          'Delivery quantity exceeds on-hand stock.',
        );
      }

      const movement = await this.createMovement(client, {
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_MOVEMENT',
          undefined,
          client,
        ),
        type: InventoryMovementType.SALES_DELIVERY,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: -dto.quantity,
        quantityBefore,
        quantityAfter,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        notes: dto.notes,
        createdBy: userId ?? null,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.SALES_DELIVERED,
        `Delivered ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        client,
      );

      return movement;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Sales Foundation (TASK-037) — posted when a Sales Return is confirmed.
   * Mirrors the inbound side of `adjustment`, always with a source-document
   * reference.
   */
  /** Accepts an optional caller-supplied `tx` (TASK-057) — see `postPurchaseReceipt`'s doc comment for why. */
  async postSalesReturn(
    dto: PostSalesReturnDto,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      const quantityBefore = await this.getOnHandQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore + dto.quantity;

      const movement = await this.createMovement(client, {
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_MOVEMENT',
          undefined,
          client,
        ),
        type: InventoryMovementType.SALES_RETURN,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore,
        quantityAfter,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        notes: dto.notes,
        createdBy: userId ?? null,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.SALES_RETURNED,
        `Returned ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        client,
      );

      return movement;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Purchasing (TASK-048) — posted when a Purchase Invoice (Goods Receipt)
   * is confirmed. Mirrors `postSalesReturn` (inbound), always with a
   * source-document reference.
   */
  /**
   * Accepts an optional caller-supplied `tx` (TASK-057) so the receipt
   * movement, its moving-average cost recalculation, and the invoice's own
   * status/posting update all commit as ONE atomic transaction — a failure
   * partway through must never leave stock received but the invoice still
   * Approved (which would double-receive on a retry).
   */
  async postPurchaseReceipt(
    dto: PostPurchaseReceiptDto,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      const quantityBefore = await this.getOnHandQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore + dto.quantity;

      const movement = await this.createMovement(client, {
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_MOVEMENT',
          undefined,
          client,
        ),
        type: InventoryMovementType.PURCHASE_RECEIPT,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        quantityBefore,
        quantityAfter,
        unitCost: dto.unitCost,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        notes: dto.notes,
        createdBy: userId ?? null,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.PURCHASE_RECEIVED,
        `Received ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        client,
      );

      // Moving-average cost is recalculated by `PurchaseInvoicePostingProvider`
      // (it already calls `InventoryValuationService.applyPurchaseReceipt`
      // inside the same posting transaction) — never here too, or the
      // average would be applied twice for one receipt. `dto.unitCost` is
      // still recorded on the movement itself, for traceability only.

      return movement;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Purchasing (TASK-048) — posted when a Purchase Return is confirmed.
   * Mirrors `postSalesDelivery` (outbound) — goods going back to the
   * Supplier decrease on-hand stock, always with a source-document reference.
   */
  /** Accepts an optional caller-supplied `tx` (TASK-057), same atomicity reasoning as `postPurchaseReceipt`. */
  async postPurchaseReturn(
    dto: PostPurchaseReturnDto,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      const quantityBefore = await this.getOnHandQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore - dto.quantity;

      if (quantityAfter < 0) {
        throw new BadRequestException('Return quantity exceeds on-hand stock.');
      }

      const movement = await this.createMovement(client, {
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_MOVEMENT',
          undefined,
          client,
        ),
        type: InventoryMovementType.PURCHASE_RETURN,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: -dto.quantity,
        quantityBefore,
        quantityAfter,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        notes: dto.notes,
        createdBy: userId ?? null,
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.PURCHASE_RETURNED,
        `Returned ${dto.quantity} of ${product.sku} at ${warehouse.code} to supplier`,
        undefined,
        client,
      );

      return movement;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  findAllMovements(query: FindMovementsQueryDto) {
    return this.prisma.inventoryMovement.findMany({
      where: {
        productId: query.productId,
        warehouseId: query.warehouseId,
        type: query.type,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: {
            sku: true,
            name: true,
            displayName: true,
            analyticAccount: { select: { name: true } },
          },
        },
        warehouse: { select: { code: true, name: true } },
        createdByUser: { select: { fullName: true } },
      },
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

  /**
   * Product Stock Card (TASK-030 section 6) — on-hand/reserved/available are
   * the same derived-from-movements values `getStock` already computes;
   * cost comes from `Product.currentCost` (ADR-0014's denormalized mirror of
   * the one active `ProductCostSnapshot`, updated in place by
   * ProductCostService). There is only one maintained cost value in this
   * foundation — no distinct weighted-average calculation engine exists yet
   * (that's section 7's "Architecture only" valuation method) — so
   * averageCost and lastCost both read that same value rather than one
   * being a fabricated separate figure.
   */
  async getStockCard(productId: string) {
    const product = await this.productsService.findOne(productId);
    return this.buildStockCard(product);
  }

  /**
   * Batched variant of getStockCard/buildStockCard for the full-catalog
   * report — the per-product version does 3 queries (on-hand aggregate,
   * reserved aggregate, last-movement lookup) which is correct for a single
   * product but was previously run once per product here too (1 + 3N
   * queries for N products). Same three numbers, computed with one
   * `groupBy` each for on-hand/reserved and one `distinct` query for the
   * latest movement per product, regardless of catalog size.
   */
  async getStockCards() {
    const products = await this.prisma.product.findMany({
      where: { isInventoryItem: true, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    if (products.length === 0) return [];
    const productIds = products.map((p) => p.id);

    const [onHandGroups, reservedGroups, lastMovements] = await Promise.all([
      this.prisma.inventoryMovement.groupBy({
        by: ['productId'],
        where: {
          productId: { in: productIds },
          type: { notIn: RESERVATION_TYPES },
        },
        _sum: { quantity: true },
      }),
      this.prisma.inventoryMovement.groupBy({
        by: ['productId'],
        where: {
          productId: { in: productIds },
          type: { in: RESERVATION_TYPES },
        },
        _sum: { quantity: true },
      }),
      this.prisma.inventoryMovement.findMany({
        where: { productId: { in: productIds } },
        orderBy: { createdAt: 'desc' },
        distinct: ['productId'],
      }),
    ]);
    const onHandByProduct = new Map(
      onHandGroups.map((g) => [g.productId, g._sum.quantity ?? 0]),
    );
    const reservedByProduct = new Map(
      reservedGroups.map((g) => [g.productId, g._sum.quantity ?? 0]),
    );
    const lastMovementByProduct = new Map(
      lastMovements.map((m) => [m.productId, m]),
    );

    return products.map((product) => {
      const onHand = onHandByProduct.get(product.id) ?? 0;
      const reserved = reservedByProduct.get(product.id) ?? 0;
      const lastMovement = lastMovementByProduct.get(product.id) ?? null;
      const cost = product.currentCost ? Number(product.currentCost) : null;
      return {
        productId: product.id,
        sku: product.sku,
        productName: product.displayName || product.name,
        onHand,
        reserved,
        available: onHand - reserved,
        averageCost: cost,
        lastCost: cost,
        stockValue: cost !== null ? cost * onHand : null,
        lastMovement: lastMovement
          ? {
              id: lastMovement.id,
              movementNumber: lastMovement.movementNumber,
              type: lastMovement.type,
              createdAt: lastMovement.createdAt,
            }
          : null,
      };
    });
  }

  private async buildStockCard(product: {
    id: string;
    sku: string;
    name: string;
    displayName: string;
    currentCost: Prisma.Decimal | null;
  }) {
    const [onHand, reserved, lastMovement] = await Promise.all([
      this.getOnHandQuantity(this.prisma, product.id),
      this.getReservedQuantity(this.prisma, product.id),
      this.prisma.inventoryMovement.findFirst({
        where: { productId: product.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const cost = product.currentCost ? Number(product.currentCost) : null;

    return {
      productId: product.id,
      sku: product.sku,
      productName: product.displayName || product.name,
      onHand,
      reserved,
      available: onHand - reserved,
      averageCost: cost,
      lastCost: cost,
      stockValue: cost !== null ? cost * onHand : null,
      lastMovement: lastMovement
        ? {
            id: lastMovement.id,
            movementNumber: lastMovement.movementNumber,
            type: lastMovement.type,
            createdAt: lastMovement.createdAt,
          }
        : null,
    };
  }

  /**
   * Warehouse Balance report (TASK-029) — real on-hand quantity per
   * product+warehouse pair, grouped straight from the movement ledger
   * (excluding the reserved ledger, same as `getOnHandQuantity`). Only pairs
   * with at least one movement are returned — no fabricated zero rows for
   * every product×warehouse combination that never happened.
   */
  async getWarehouseBalances() {
    const grouped = await this.prisma.inventoryMovement.groupBy({
      by: ['productId', 'warehouseId'],
      where: { type: { notIn: RESERVATION_TYPES } },
      _sum: { quantity: true },
    });

    const productIds = [...new Set(grouped.map((row) => row.productId))];
    const warehouseIds = [...new Set(grouped.map((row) => row.warehouseId))];

    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true, displayName: true },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

    return grouped
      .map((row) => ({
        productId: row.productId,
        product: productMap.get(row.productId) ?? null,
        warehouseId: row.warehouseId,
        warehouse: warehouseMap.get(row.warehouseId) ?? null,
        onHand: row._sum.quantity ?? 0,
      }))
      .filter((row) => row.onHand !== 0);
  }

  /** System setting only (TASK-030 section 7) — "Architecture only," Average Cost is the default; no FIFO/Average calculation reads this yet. */
  async getValuationSettings() {
    return this.prisma.inventorySettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
  }

  async updateValuationSettings(
    valuationMethod: InventoryValuationMethod,
    userId?: string,
  ) {
    return this.prisma.inventorySettings.upsert({
      where: { id: 1 },
      update: { valuationMethod, updatedBy: userId ?? null },
      create: { id: 1, valuationMethod, updatedBy: userId ?? null },
    });
  }

  private async decreaseQuantity(
    dto: BaseQuantityMovementDto,
    type: InventoryMovementType,
    activityType: string,
    label: string,
    userId?: string,
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
        movementNumber: await this.numberingEngine.generateNumber(
          'INVENTORY_MOVEMENT',
          undefined,
          tx,
        ),
        type,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: -dto.quantity,
        quantityBefore,
        quantityAfter,
        notes: dto.notes,
        createdBy: userId ?? null,
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
