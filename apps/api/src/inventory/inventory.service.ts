import {
  BadRequestException,
  ConflictException,
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
import { PostSalesReturnDto } from './dto/post-sales-return.dto';
import { PostPurchaseReceiptDto } from './dto/post-purchase-receipt.dto';
import { PostPurchaseReturnDto } from './dto/post-purchase-return.dto';
import { prismaEnumFilter } from '../common/query/enum-list';
import {
  type MovementTrace,
  type PostSalesDeliveryInput,
} from './dto/movement-trace';
import { ownerAgentCondition } from './dto/owner-filter';
import { round2 } from '../accounting/inventory-valuation/inventory-valuation.service';

const RESERVATION_TYPES: InventoryMovementType[] = [
  InventoryMovementType.RESERVATION,
  InventoryMovementType.RESERVATION_RELEASE,
];

/** The product columns a stock card reads (owner shown on the card — R13). */
type StockCardProduct = {
  id: string;
  sku: string;
  name: string;
  displayName: string;
  currentCost: Prisma.Decimal | null;
  ownerAgent?: { id: string; name: string } | null;
};

/**
 * Owner agent of a product at movement time (spec §4). Share-locks the
 * product row (conflicts with ProductsService's owner-change FOR UPDATE).
 * Every InventoryMovement insert must stamp this value.
 */
export async function movementOwnerAgentId(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ owner_agent_id: string | null }[]>`
    SELECT owner_agent_id FROM products WHERE id = ${productId}::uuid FOR SHARE
  `;
  return rows[0]?.owner_agent_id ?? null;
}

/**
 * R13 — the single stock-writer lock. Takes `SELECT … FOR UPDATE` on the
 * affected `products` rows, in sorted id order (so two transactions that touch
 * the same products in a different order can never deadlock), BEFORE the
 * writer reads on-hand. Concurrent decrements of the same product therefore
 * serialize and the second one re-reads the committed balance. It also
 * conflicts with `movementOwnerAgentId`'s FOR SHARE and with the owner-change
 * lock of ProductsService, which is what we want.
 */
export async function lockProductsForUpdate(
  tx: Prisma.TransactionClient,
  productIds: string[],
): Promise<void> {
  const ids = [...new Set(productIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE
  `;
}

function duplicateMovementError(idempotencyKey: string) {
  return new ConflictException({
    code: 'INVENTORY_DUPLICATE_MOVEMENT',
    message:
      'This stock movement was already posted — the operation was not repeated.',
    idempotencyKey,
  });
}

/** The traceability columns of a document-driven movement (undefined ones are omitted by Prisma). */
function traceFields(trace: MovementTrace) {
  return {
    idempotencyKey: trace.idempotencyKey,
    parentProductId: trace.parentProductId,
    recipeId: trace.recipeId,
  };
}

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
      await lockProductsForUpdate(tx, [dto.productId]);
      const quantityBefore = await this.getOnHandQuantity(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore + dto.quantity;

      // Opening balances are deliberately NOT posted to the GL (Opening
      // Balance Wizard / fiscal-year opening entries own that); transfers are
      // value-neutral per company and also never post.
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
      await lockProductsForUpdate(tx, [dto.productId]);
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
      if (dto.quantity < 0) {
        await this.assertUnreservedStock(tx, {
          product,
          warehouse,
          onHand: quantityBefore,
          quantity: -dto.quantity,
          operation: 'Adjustment',
        });
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
      // Every line's product, once, in sorted order — before any on-hand read.
      await lockProductsForUpdate(
        tx,
        dto.lines.map((line) => line.productId),
      );
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

  /** Accepts an optional caller-supplied `tx` so a multi-line reservation
   *  (Sales Order confirm) is all-or-nothing — a retry after a failed line
   *  must never double-reserve the lines that had already succeeded. */
  async reserve(
    dto: ReserveDto & MovementTrace,
    userId?: string,
    outerTx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (tx: Prisma.TransactionClient) => {
      await lockProductsForUpdate(tx, [dto.productId]);
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
          `Cannot reserve ${dto.quantity} of ${product.sku} at ${warehouse.code} — only ${Math.max(available, 0)} available.`,
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
        ...traceFields(dto),
      });

      await this.activityService.log(
        movement.id,
        InventoryMovementActivityType.RESERVED,
        `Reserved ${dto.quantity} of ${product.sku} at ${warehouse.code}`,
        undefined,
        tx,
      );

      return movement;
    };
    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }

  /** Accepts an optional caller-supplied `tx` (TASK-057) — see `postPurchaseReceipt`'s doc comment for why. */
  async release(
    dto: ReleaseDto & MovementTrace,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      await lockProductsForUpdate(client, [dto.productId]);
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
        ...traceFields(dto),
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
    dto: PostSalesDeliveryInput,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      await lockProductsForUpdate(client, [dto.productId]);
      const quantityBefore = await this.getOnHandQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore - dto.quantity;

      if (quantityAfter < 0) {
        throw new BadRequestException(
          `Delivery quantity exceeds on-hand stock for ${product.sku} at warehouse ${warehouse.code} (on-hand ${quantityBefore}, requested ${dto.quantity}). Post an opening balance or inventory adjustment first.`,
        );
      }

      // R13 (F7) — delivery checks AVAILABILITY, not just on-hand: stock
      // reserved for other documents cannot be shipped.
      //
      // The reservation of the delivery's own flow may be consumed: the caller
      // names it with `ignoreReservedForReference` (e.g. the Sales Order a
      // Sales Invoice fulfils); when it does not, the delivery's own
      // referenceType/referenceId is used (a reservation made under the same
      // reference). At most the delivered quantity of that reservation is
      // credited, because that is all the caller will release afterwards:
      //   available = onHand − (reservedTotal − min(ownReserved, quantity))
      // Existing callers that release their reservation AFTER delivering (the
      // B2B invoice) therefore keep working once they name the order; callers
      // that release first simply see a smaller reservedTotal.
      const ownReference = dto.ignoreReservedForReference ?? {
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
      };
      const [reserved, ownReserved] = await Promise.all([
        this.getReservedQuantity(client, dto.productId, dto.warehouseId),
        this.getReservedQuantity(
          client,
          dto.productId,
          dto.warehouseId,
          ownReference,
        ),
      ]);
      const credited = Math.min(Math.max(ownReserved, 0), dto.quantity);
      const available = quantityBefore - (reserved - credited);
      if (dto.quantity > available) {
        throw new BadRequestException({
          code: 'INVENTORY_AVAILABLE_INSUFFICIENT',
          message: `Delivery quantity exceeds the available stock for ${product.sku} at warehouse ${warehouse.code} (on-hand ${quantityBefore}, reserved for other documents ${reserved - credited}, requested ${dto.quantity}).`,
        });
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
        ...traceFields(dto),
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
    dto: PostSalesReturnDto & MovementTrace,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      await lockProductsForUpdate(client, [dto.productId]);
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
        ...traceFields(dto),
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
    dto: PostPurchaseReceiptDto & MovementTrace,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      await lockProductsForUpdate(client, [dto.productId]);
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
        ...traceFields(dto),
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
    dto: PostPurchaseReturnDto & MovementTrace,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const product = await this.assertInventoryProduct(dto.productId);
    const warehouse = await this.assertActiveWarehouse(dto.warehouseId);

    const run = async (client: Prisma.TransactionClient) => {
      await lockProductsForUpdate(client, [dto.productId]);
      const quantityBefore = await this.getOnHandQuantity(
        client,
        dto.productId,
        dto.warehouseId,
      );
      const quantityAfter = quantityBefore - dto.quantity;

      if (quantityAfter < 0) {
        throw new BadRequestException('Return quantity exceeds on-hand stock.');
      }
      await this.assertUnreservedStock(client, {
        product,
        warehouse,
        onHand: quantityBefore,
        quantity: dto.quantity,
        operation: 'Purchase return',
      });

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
        ...traceFields(dto),
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
        productId: prismaEnumFilter(query.productId),
        warehouseId: prismaEnumFilter(query.warehouseId),
        type: prismaEnumFilter(query.type),
        referenceId: prismaEnumFilter(query.referenceId),
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

  /**
   * Derived stock of one product (optionally one warehouse). R13: the row
   * carries the product's owner (`ownerAgentId` / `ownerAgentName`, null =
   * company) and the optional `owner` filter (`COMPANY|AGENT|<agentId>`) —
   * a product whose owner does not match reads as zero, never as somebody
   * else's stock.
   */
  async getStock(productId: string, warehouseId?: string, owner?: string) {
    const product = await this.productsService.findOne(productId);
    if (warehouseId) {
      await this.warehousesService.findOne(warehouseId);
    }

    const ownerCondition = ownerAgentCondition(owner);
    const [onHand, reserved] = await Promise.all([
      this.getOnHandQuantity(
        this.prisma,
        productId,
        warehouseId,
        ownerCondition,
      ),
      this.getReservedQuantity(
        this.prisma,
        productId,
        warehouseId,
        undefined,
        ownerCondition,
      ),
    ]);

    return {
      productId,
      warehouseId: warehouseId ?? null,
      onHand,
      reserved,
      available: onHand - reserved,
      ownerAgentId: product.ownerAgent?.id ?? null,
      ownerAgentName: product.ownerAgent?.name ?? null,
    };
  }

  /**
   * Agents milestone (spec §4) — an agent's stock per product/warehouse,
   * from the owner snapshot on the movements (never re-attributed). Every
   * product the agent owns is listed; one without movements shows zeros.
   * `shipped` = Σ |SALES_DELIVERY|, `returned` = Σ SALES_RETURN.
   */
  async getAgentStock(
    agentId: string,
    filter: { productId?: string; warehouseId?: string } = {},
  ) {
    const [groups, products] = await Promise.all([
      this.prisma.inventoryMovement.groupBy({
        by: ['productId', 'warehouseId', 'type'],
        where: {
          ownerAgentId: agentId,
          productId: filter.productId,
          warehouseId: filter.warehouseId,
        },
        _sum: { quantity: true },
      }),
      this.prisma.product.findMany({
        where: {
          ownerAgentId: agentId,
          deletedAt: null,
          ...(filter.productId ? { id: filter.productId } : {}),
        },
        select: {
          id: true,
          sku: true,
          name: true,
          nameEn: true,
          displayName: true,
          isInventoryItem: true,
          status: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    type Row = {
      productId: string;
      warehouseId: string | null;
      onHand: number;
      reserved: number;
      shipped: number;
      returned: number;
    };
    const rows = new Map<string, Row>();
    for (const group of groups) {
      const key = `${group.productId}:${group.warehouseId}`;
      const row = rows.get(key) ?? {
        productId: group.productId,
        warehouseId: group.warehouseId,
        onHand: 0,
        reserved: 0,
        shipped: 0,
        returned: 0,
      };
      const qty = group._sum.quantity ?? 0;
      if (RESERVATION_TYPES.includes(group.type)) row.reserved += qty;
      else row.onHand += qty;
      if (group.type === InventoryMovementType.SALES_DELIVERY) {
        row.shipped += Math.abs(qty);
      }
      if (group.type === InventoryMovementType.SALES_RETURN) {
        row.returned += qty;
      }
      rows.set(key, row);
    }
    if (!filter.warehouseId) {
      for (const product of products) {
        const hasRow = [...rows.values()].some(
          (row) => row.productId === product.id,
        );
        if (!hasRow) {
          rows.set(`${product.id}:none`, {
            productId: product.id,
            warehouseId: null,
            onHand: 0,
            reserved: 0,
            shipped: 0,
            returned: 0,
          });
        }
      }
    }
    const warehouseIds = [
      ...new Set(
        [...rows.values()]
          .map((row) => row.warehouseId)
          .filter((id): id is string => !!id),
      ),
    ];
    const warehouses = warehouseIds.length
      ? await this.prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
    const items = [...rows.values()]
      .filter((row) => productById.has(row.productId))
      .map((row) => ({
        ...row,
        available: row.onHand - row.reserved,
        product: productById.get(row.productId)!,
        warehouse: row.warehouseId
          ? (warehouseById.get(row.warehouseId) ?? null)
          : null,
      }))
      .sort(
        (a, b) =>
          a.product.name.localeCompare(b.product.name) ||
          (a.warehouse?.name ?? '').localeCompare(b.warehouse?.name ?? ''),
      );
    const totals = items.reduce(
      (acc, row) => ({
        onHand: acc.onHand + row.onHand,
        reserved: acc.reserved + row.reserved,
        available: acc.available + row.available,
        shipped: acc.shipped + row.shipped,
        returned: acc.returned + row.returned,
      }),
      { onHand: 0, reserved: 0, available: 0, shipped: 0, returned: 0 },
    );
    return { agentId, items, totals };
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
  async getStockCards(owner?: string) {
    const products = await this.prisma.product.findMany({
      where: {
        isInventoryItem: true,
        deletedAt: null,
        ownerAgentId: ownerAgentCondition(owner),
      },
      orderBy: { name: 'asc' },
      include: { ownerAgent: { select: { id: true, name: true } } },
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
      return {
        ...this.stockCardIdentity(product),
        onHand,
        reserved,
        available: onHand - reserved,
        ...this.stockCardCost(product, onHand),
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

  /** Product + owner columns shared by every stock card shape (R13: owner shown on the card). */
  private stockCardIdentity(product: StockCardProduct) {
    return {
      productId: product.id,
      sku: product.sku,
      productName: product.displayName || product.name,
      ownerAgentId: product.ownerAgent?.id ?? null,
      ownerAgentName: product.ownerAgent?.name ?? null,
    };
  }

  /**
   * Cost columns of a stock card. `stockValue` is a COMPANY figure: agent-owned
   * stock is never a company asset (R13 spec §5), so an agent product's card
   * carries `null` here and can never add to a valuation total.
   */
  private stockCardCost(product: StockCardProduct, onHand: number) {
    const cost = product.currentCost ? Number(product.currentCost) : null;
    const companyOwned = !product.ownerAgent;
    return {
      averageCost: cost,
      lastCost: cost,
      stockValue:
        cost !== null && companyOwned
          ? round2(product.currentCost!.mul(onHand)).toNumber()
          : null,
    };
  }

  private async buildStockCard(product: StockCardProduct) {
    const [onHand, reserved, lastMovement] = await Promise.all([
      this.getOnHandQuantity(this.prisma, product.id),
      this.getReservedQuantity(this.prisma, product.id),
      this.prisma.inventoryMovement.findFirst({
        where: { productId: product.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      ...this.stockCardIdentity(product),
      onHand,
      reserved,
      available: onHand - reserved,
      ...this.stockCardCost(product, onHand),
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
  async getWarehouseBalances(owner?: string) {
    // The owner is the movement's snapshot (never re-attributed), so a row is
    // one product + warehouse + owner — company and agent stock never mix.
    const grouped = await this.prisma.inventoryMovement.groupBy({
      by: ['productId', 'warehouseId', 'ownerAgentId'],
      where: {
        type: { notIn: RESERVATION_TYPES },
        ownerAgentId: ownerAgentCondition(owner),
      },
      _sum: { quantity: true },
    });

    const productIds = [...new Set(grouped.map((row) => row.productId))];
    const warehouseIds = [...new Set(grouped.map((row) => row.warehouseId))];
    const agentIds = [
      ...new Set(
        grouped
          .map((row) => row.ownerAgentId)
          .filter((id): id is string => !!id),
      ),
    ];

    const [products, warehouses, agents] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true, displayName: true },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, code: true, name: true },
      }),
      agentIds.length
        ? this.prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
    const agentMap = new Map(agents.map((a) => [a.id, a.name]));

    return grouped
      .map((row) => ({
        productId: row.productId,
        product: productMap.get(row.productId) ?? null,
        warehouseId: row.warehouseId,
        warehouse: warehouseMap.get(row.warehouseId) ?? null,
        ownerAgentId: row.ownerAgentId,
        ownerAgentName: row.ownerAgentId
          ? (agentMap.get(row.ownerAgentId) ?? null)
          : null,
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
      await lockProductsForUpdate(tx, [dto.productId]);
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
      await this.assertUnreservedStock(tx, {
        product,
        warehouse,
        onHand: quantityBefore,
        quantity: dto.quantity,
        operation: label,
      });

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

      // Write-off at the current average (forward-only, same Dr/Cr as an
      // adjustment); agent-owned goods never reach the company GL — the
      // provider skips them (R13 spec §6, F11).
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
   * R13 — a confirmed Physical Count's line, through the same locked and
   * validated path as every other writer: the product row is locked, the
   * before/after are read from the locked ledger inside `tx`, and the
   * PHYSICAL_COUNT movement is posted to the GL like an adjustment. The caller
   * (PhysicalCountService) locks all of the count's products once, sorted,
   * before the first line. Duplicate protection: one movement per count line.
   */
  async postPhysicalCountLine(
    tx: Prisma.TransactionClient,
    input: {
      countId: string;
      countLineId: string;
      movementNumber: string;
      productId: string;
      sku: string;
      warehouseId: string;
      countNumber: string;
      difference: number;
      notes?: string | null;
      userId?: string;
    },
  ) {
    await lockProductsForUpdate(tx, [input.productId]);
    const quantityBefore = await this.getOnHandQuantity(
      tx,
      input.productId,
      input.warehouseId,
    );
    const quantityAfter = quantityBefore + input.difference;
    if (quantityAfter < 0) {
      throw new BadRequestException(
        `Confirming would result in negative stock for ${input.sku}.`,
      );
    }

    const movement = await this.createMovement(tx, {
      movementNumber: input.movementNumber,
      type: InventoryMovementType.PHYSICAL_COUNT,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.difference,
      quantityBefore,
      quantityAfter,
      referenceType: 'PHYSICAL_COUNT',
      referenceId: input.countId,
      reason: 'Physical Count',
      notes: input.notes,
      createdBy: input.userId ?? null,
      idempotencyKey: `PHYSICAL_COUNT:${input.countId}:${input.countLineId}:${InventoryMovementType.PHYSICAL_COUNT}`,
    });
    await this.activityService.log(
      movement.id,
      InventoryMovementActivityType.PHYSICAL_COUNT_ADJUSTED,
      `Physical count ${input.countNumber} adjusted ${input.sku} by ${input.difference}`,
      undefined,
      tx,
    );
    await this.postingEngine.post(
      'INVENTORY_ADJUSTMENT',
      movement.id,
      input.userId,
      tx,
    );
    return movement;
  }

  /**
   * R13 — the stock side of an assembly order (and of its reversal): one
   * PRODUCTION_CONSUMPTION (component out, negative) or PRODUCTION_OUTPUT
   * (finished item in, positive) movement per call, through the locked,
   * non-negative, idempotent path. The caller (assembly service) locks every
   * affected product once, sorted, with `lockProductsForUpdate` first. Reversal
   * is the opposite sign with its own idempotency key. Posting is the caller's
   * (ASSEMBLY_ORDER provider) — nothing is posted here.
   *
   * `allowInactiveProduct` — reversal only: stock going back to where it came
   * from (positive PRODUCTION_CONSUMPTION / negative PRODUCTION_OUTPUT) may
   * touch a product archived or deactivated since the assembly; it must still
   * exist and be stock-tracked. New consumption / output never accepts it.
   */
  async postProductionMovement(
    tx: Prisma.TransactionClient,
    input: {
      type: 'PRODUCTION_CONSUMPTION' | 'PRODUCTION_OUTPUT';
      productId: string;
      warehouseId: string;
      /** Signed whole units — negative removes stock, positive adds it. */
      quantity: number;
      referenceType: string;
      referenceId: string;
      idempotencyKey: string;
      unitCost?: Prisma.Decimal | string | number;
      notes?: string;
      userId?: string;
      allowInactiveProduct?: boolean;
    } & Pick<MovementTrace, 'parentProductId' | 'recipeId'>,
  ) {
    if (!Number.isInteger(input.quantity) || input.quantity === 0) {
      throw new BadRequestException(
        'A production movement needs a non-zero whole quantity.',
      );
    }
    const product = input.allowInactiveProduct
      ? await this.assertReversibleProduct(tx, input)
      : await this.assertInventoryProduct(input.productId);
    const warehouse = await this.assertActiveWarehouse(input.warehouseId);
    await lockProductsForUpdate(tx, [input.productId]);

    const quantityBefore = await this.getOnHandQuantity(
      tx,
      input.productId,
      input.warehouseId,
    );
    const quantityAfter = quantityBefore + input.quantity;
    if (quantityAfter < 0) {
      throw new BadRequestException(
        `Not enough stock of ${product.sku} at ${warehouse.code} (on-hand ${quantityBefore}, needed ${-input.quantity}).`,
      );
    }
    const movement = await this.createMovement(tx, {
      movementNumber: await this.numberingEngine.generateNumber(
        'INVENTORY_MOVEMENT',
        undefined,
        tx,
      ),
      type: InventoryMovementType[input.type],
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      quantityBefore,
      quantityAfter,
      unitCost: input.unitCost,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes,
      createdBy: input.userId ?? null,
      idempotencyKey: input.idempotencyKey,
      parentProductId: input.parentProductId,
      recipeId: input.recipeId,
    });
    await this.activityService.log(
      movement.id,
      input.quantity < 0
        ? InventoryMovementActivityType.PRODUCTION_CONSUMED
        : InventoryMovementActivityType.PRODUCTION_OUTPUT_RECEIVED,
      `${input.quantity < 0 ? 'Consumed' : 'Received'} ${Math.abs(input.quantity)} of ${product.sku} at ${warehouse.code}`,
      undefined,
      tx,
    );
    return movement;
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

  /**
   * A production REVERSAL may return stock of a product archived / deactivated
   * after the assembly (the row must exist and still be stock-tracked); any
   * other direction is new consumption / output and is refused here.
   */
  private async assertReversibleProduct(
    tx: Prisma.TransactionClient,
    input: {
      type: 'PRODUCTION_CONSUMPTION' | 'PRODUCTION_OUTPUT';
      productId: string;
      quantity: number;
    },
  ) {
    const reversal =
      input.type === 'PRODUCTION_CONSUMPTION'
        ? input.quantity > 0
        : input.quantity < 0;
    if (!reversal) {
      throw new BadRequestException(
        'Only a production reversal may move an inactive product.',
      );
    }
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, sku: true, isInventoryItem: true },
    });
    if (!product) {
      throw new NotFoundException(`Product ${input.productId} not found`);
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

  /**
   * The single insert path for movements. Agents milestone (spec §4): every
   * movement snapshots its product's owner agent (null = company stock),
   * read inside the same transaction; the product row is share-locked so an
   * owner change cannot interleave with the first movement.
   */
  private async createMovement(
    tx: Prisma.TransactionClient,
    data: Prisma.InventoryMovementUncheckedCreateInput,
  ) {
    // Duplicate protection (R13): a document-driven writer's key was already
    // used — a 409, never a second movement. The product lock taken by the
    // writer makes this check race-free; the unique index is the backstop.
    const { idempotencyKey } = data;
    if (idempotencyKey) {
      const existing = await tx.inventoryMovement.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) throw duplicateMovementError(idempotencyKey);
    }
    const ownerAgentId = await movementOwnerAgentId(tx, data.productId);
    try {
      return await tx.inventoryMovement.create({
        data: { ...data, ownerAgentId },
      });
    } catch (error) {
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw duplicateMovementError(idempotencyKey);
      }
      throw error;
    }
  }

  /** On-hand quantity: excludes the reserved ledger (RESERVATION/RESERVATION_RELEASE). */
  private async getOnHandQuantity(
    tx: Prisma.TransactionClient | PrismaService,
    productId: string,
    warehouseId?: string,
    ownerAgentId?: Prisma.StringNullableFilter | null,
  ): Promise<number> {
    const result = await tx.inventoryMovement.aggregate({
      where: {
        productId,
        warehouseId,
        ownerAgentId,
        type: { notIn: RESERVATION_TYPES },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  /**
   * R13 (L6) — a write-off (damage / expired), a negative adjustment or a
   * purchase return takes stock out of the warehouse: it may only take what
   * is not reserved for other documents (`onHand − reserved`), otherwise the
   * reserved ledger would exceed the stock left (I2). A physical count is not
   * routed here — it records reality and is reported by the integrity check.
   * Runs under the caller's product lock, after its on-hand read.
   */
  private async assertUnreservedStock(
    client: Prisma.TransactionClient,
    input: {
      product: { id: string; sku: string };
      warehouse: { id: string; code: string };
      onHand: number;
      quantity: number;
      operation: string;
    },
  ): Promise<void> {
    const reserved = await this.getReservedQuantity(
      client,
      input.product.id,
      input.warehouse.id,
    );
    const available = input.onHand - reserved;
    if (input.quantity > available) {
      throw new BadRequestException({
        code: 'INVENTORY_RESERVED_STOCK',
        message: `${input.operation} of ${input.quantity} × ${input.product.sku} at ${input.warehouse.code} would take stock reserved for other documents (on-hand ${input.onHand}, reserved ${reserved}, available ${Math.max(available, 0)}). Release or deliver the reservation first.`,
      });
    }
  }

  /**
   * Reserved ledger only: RESERVATION (+) and RESERVATION_RELEASE (-).
   * `reference` narrows it to the reservations of one business document.
   */
  private async getReservedQuantity(
    tx: Prisma.TransactionClient | PrismaService,
    productId: string,
    warehouseId?: string,
    reference?: { referenceType: string; referenceId: string },
    ownerAgentId?: Prisma.StringNullableFilter | null,
  ): Promise<number> {
    const result = await tx.inventoryMovement.aggregate({
      where: {
        productId,
        warehouseId,
        ownerAgentId,
        referenceType: reference?.referenceType,
        referenceId: reference?.referenceId,
        type: { in: RESERVATION_TYPES },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }
}
