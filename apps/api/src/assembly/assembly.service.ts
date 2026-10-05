import { randomUUID } from 'crypto';
import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import {
  AssemblyStatus,
  Prisma,
  ProductSupplyMethod,
  type ProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import {
  InventoryValuationService,
  round2,
  round4,
} from '../accounting/inventory-valuation/inventory-valuation.service';
import {
  InventoryService,
  lockProductsForUpdate,
} from '../inventory/inventory.service';
import { readStockAvailability } from '../inventory/stock-lines/stock-availability';
import { ProductActivityService } from '../products/activities/product-activity.service';
import { RecipeService, type LoadedRecipe } from '../recipes/recipe.service';
import {
  maximumAssemblableQuantity,
  ownerViolation,
} from '../recipes/recipe-rules';
import {
  conflict,
  notFound,
  unprocessable,
} from '../common/errors/business-errors';
import { AssemblyCostService } from './assembly-cost.service';
import { computeAssemblyCost } from './assembly-cost';
import type {
  AssemblyPreviewQueryDto,
  CreateAssemblyDto,
  ListAssemblyQueryDto,
  ReverseAssemblyDto,
} from './dto/assembly.dto';

const REFERENCE_TYPE = 'ASSEMBLY_ORDER';
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
const DIRECT_COST_PERMISSION = 'inventory.assembly.direct_cost';

/** Timeline entries written to the finished product's activity log. */
export const AssemblyActivityType = {
  ASSEMBLY_POSTED: 'ASSEMBLY_POSTED',
  ASSEMBLY_REVERSED: 'ASSEMBLY_REVERSED',
} as const;

const ORDER_INCLUDE = {
  product: { select: { id: true, sku: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { componentProduct: { sku: 'asc' } },
    include: {
      componentProduct: { select: { id: true, sku: true, name: true } },
    },
  },
} satisfies Prisma.AssemblyOrderInclude;

type LoadedOrder = Prisma.AssemblyOrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

type Client = Prisma.TransactionClient | PrismaService;

export interface AssemblyBlocker {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface PlanLine {
  componentProductId: string;
  sku: string;
  name: string;
  /** Whole stock units consumed for the requested quantity. */
  quantity: number;
  available: number;
  unitCost: Prisma.Decimal;
  value: Prisma.Decimal;
  recipeQuantity: Prisma.Decimal;
  unitId: string;
  quantityPerRun: Prisma.Decimal;
}

interface AssemblyPlan {
  blockers: AssemblyBlocker[];
  product: {
    id: string;
    sku: string;
    name: string;
    ownerAgentId: string | null;
  };
  recipe: LoadedRecipe | null;
  lines: PlanLine[];
}

export interface AssemblyOrderView {
  id: string;
  assemblyNumber: string;
  status: AssemblyStatus;
  productId: string;
  product: { id: string; sku: string; name: string };
  warehouseId: string;
  warehouse: { id: string; code: string; name: string };
  recipeId: string;
  recipeVersion: number;
  recipeSnapshot: Prisma.JsonValue;
  quantity: number;
  ownerAgentId: string | null;
  /** Cost figures are `null` for a caller without cost visibility. */
  componentCost: string | null;
  directCost: string | null;
  totalCost: string | null;
  unitCost: string | null;
  lines: {
    id: string;
    componentProductId: string;
    componentSku: string;
    componentName: string;
    quantity: number;
    unitCost: string | null;
    value: string | null;
    consumptionMovementId: string | null;
    reversalMovementId: string | null;
  }[];
  outputMovementId: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  reversedAt: Date | null;
  reversedBy: string | null;
  reversalReason: string | null;
}

export interface AssemblyPreview {
  canAssemble: boolean;
  blockers: { code: string; message: string }[];
  recipe: { id: string; version: number } | null;
  lines: {
    componentProductId: string;
    name: string;
    quantity: number;
    available: number;
    unitCost: string | null;
    value: string | null;
  }[];
  componentCost: string | null;
  directCostEstimate: string | null;
  estimatedUnitCost: string | null;
  maximumQuantity: number;
}

const errorCode = (error: unknown): string | undefined =>
  error instanceof HttpException
    ? (error.getResponse() as { code?: string }).code
    : undefined;

const label = (item: { sku: string; name: string }) =>
  `${item.sku} ${item.name}`;

/**
 * Assembly orders (R13 spec §3 A): consume the components of the ACTIVE recipe
 * and receive the finished item in ONE transaction — every involved product is
 * row-locked first (sorted), consumption is valued at each component's moving
 * average, the finished unit cost is `(Σ line values + direct cost) ÷ quantity`
 * and the journal (company stock only) is posted through the Posting Engine in
 * the same transaction. Stock movements go through `InventoryService` (locked,
 * non-negative, idempotent); costing through `InventoryValuationService`.
 */
@Injectable()
export class AssemblyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipeService,
    private readonly inventory: InventoryService,
    private readonly valuation: InventoryValuationService,
    private readonly assemblyCost: AssemblyCostService,
    private readonly postingEngine: PostingEngineService,
    private readonly numbering: NumberingEngineService,
    private readonly permissions: PermissionsResolverService,
    private readonly activities: ProductActivityService,
  ) {}

  // ------------------------------------------------------------------ preview

  async preview(
    query: AssemblyPreviewQueryDto,
    includeCosts: boolean,
  ): Promise<AssemblyPreview> {
    const plan = await this.buildPlan(this.prisma, query);
    const show = (value: Prisma.Decimal) =>
      includeCosts ? value.toString() : null;
    const recipe = plan.recipe;
    const componentCost = plan.lines.reduce(
      (sum, line) => sum.add(line.value),
      new Prisma.Decimal(0),
    );
    const directEstimate = recipe
      ? round2(
          recipe.directCostEstimate.mul(
            this.recipes.runsFor(recipe, query.quantity),
          ),
        )
      : new Prisma.Decimal(0);
    return {
      canAssemble: plan.blockers.length === 0,
      blockers: plan.blockers.map(({ code, message }) => ({ code, message })),
      recipe: recipe && { id: recipe.id, version: recipe.version },
      lines: plan.lines.map((line) => ({
        componentProductId: line.componentProductId,
        name: line.name,
        quantity: line.quantity,
        available: line.available,
        unitCost: show(line.unitCost),
        value: show(line.value),
      })),
      componentCost: show(componentCost),
      directCostEstimate: show(directEstimate),
      estimatedUnitCost: show(
        round4(componentCost.add(directEstimate).div(query.quantity)),
      ),
      maximumQuantity:
        recipe && plan.lines.length > 0
          ? maximumAssemblableQuantity(
              plan.lines.map((line) => ({
                perUnit: line.quantityPerRun.div(recipe.outputQuantity),
                available: line.available,
              })),
            )
          : 0,
    };
  }

  // ------------------------------------------------------------------- create

  /**
   * Assembles. A repeated `idempotencyKey` returns the original order
   * (`replayed: true`) instead of assembling twice — also under concurrency:
   * the duplicate waits on the product locks and finds the committed order.
   */
  async create(
    dto: CreateAssemblyDto,
    userId: string,
    options: { idempotencyKey?: string; includeCosts: boolean },
  ): Promise<{ order: AssemblyOrderView; replayed: boolean }> {
    const key = (dto.idempotencyKey ?? options.idempotencyKey)?.trim() || null;
    const view = (order: LoadedOrder) => toView(order, options.includeCosts);

    if (key) {
      const existing = await this.findByKey(this.prisma, key);
      if (existing) {
        return {
          order: view(this.assertSameRequest(existing, dto)),
          replayed: true,
        };
      }
    }
    try {
      const result = await this.prisma.$transaction(
        (tx) => this.assemble(tx, dto, userId, key),
        TRANSACTION_OPTIONS,
      );
      return { order: view(result.order), replayed: result.replayed };
    } catch (error) {
      if (key && isUniqueViolation(error)) {
        const existing = await this.findByKey(this.prisma, key);
        if (existing) {
          return {
            order: view(this.assertSameRequest(existing, dto)),
            replayed: true,
          };
        }
      }
      throw error;
    }
  }

  private async assemble(
    tx: Prisma.TransactionClient,
    dto: CreateAssemblyDto,
    userId: string,
    key: string | null,
  ): Promise<{ order: LoadedOrder; replayed: boolean }> {
    // Lock the finished product and every component of the recipe, sorted, in one
    // statement (deadlock-free against other assemblies / stock writers).
    const preRecipe = await this.recipes.getActiveRecipe(tx, dto.productId);
    const lockIds = [
      dto.productId,
      ...(preRecipe?.lines.map((line) => line.componentProductId) ?? []),
    ];
    await lockProductsForUpdate(tx, lockIds);

    if (key) {
      const existing = await this.findByKey(tx, key);
      if (existing) {
        return {
          order: this.assertSameRequest(existing, dto),
          replayed: true,
        };
      }
    }

    const plan = await this.buildPlan(tx, dto);
    const firstBlocker = plan.blockers[0];
    if (firstBlocker) {
      throw unprocessable(firstBlocker.code, firstBlocker.message, {
        ...firstBlocker.details,
        blockers: plan.blockers.map(({ code, message }) => ({ code, message })),
      });
    }
    const recipe = plan.recipe;
    if (!recipe)
      throw new Error('A plan without blockers always has a recipe.');
    if (
      !plan.lines.every((line) => lockIds.includes(line.componentProductId))
    ) {
      throw conflict(
        'ASSEMBLY_RECIPE_CHANGED',
        'The recipe was changed while the assembly was being prepared — try again.',
      );
    }

    const directCost = round2(dto.directCost ?? 0);
    const ownerAgentId = plan.product.ownerAgentId;
    await this.assertDirectCostAllowed(tx, directCost, ownerAgentId, userId);

    const orderId = randomUUID();
    const cost = computeAssemblyCost({
      lines: plan.lines.map((line) => ({
        componentProductId: line.componentProductId,
        quantity: line.quantity,
        unitCost: line.unitCost,
      })),
      directCost,
      quantity: dto.quantity,
    });

    // 1. Consume the components at their current moving average.
    const consumptionIds = new Map<string, string>();
    for (const line of cost.lines) {
      const movement = await this.inventory.postProductionMovement(tx, {
        type: 'PRODUCTION_CONSUMPTION',
        productId: line.componentProductId,
        warehouseId: dto.warehouseId,
        quantity: -line.quantity,
        referenceType: REFERENCE_TYPE,
        referenceId: orderId,
        idempotencyKey: `${REFERENCE_TYPE}:${orderId}:${line.componentProductId}:PRODUCTION_CONSUMPTION`,
        unitCost: line.unitCost,
        parentProductId: plan.product.id,
        recipeId: recipe.id,
        userId,
      });
      consumptionIds.set(line.componentProductId, movement.id);
    }

    // 2. Receive the finished item; the average blends the TOTAL value.
    const onHandBefore = await this.valuation.getOnHandQuantity(
      tx,
      plan.product.id,
    );
    const output = await this.inventory.postProductionMovement(tx, {
      type: 'PRODUCTION_OUTPUT',
      productId: plan.product.id,
      warehouseId: dto.warehouseId,
      quantity: dto.quantity,
      referenceType: REFERENCE_TYPE,
      referenceId: orderId,
      idempotencyKey: `${REFERENCE_TYPE}:${orderId}:${plan.product.id}:PRODUCTION_OUTPUT`,
      unitCost: cost.unitCost,
      recipeId: recipe.id,
      userId,
    });
    await this.valuation.applyAssemblyOutput(tx, {
      productId: plan.product.id,
      quantityReceived: dto.quantity,
      totalValue: cost.totalCost,
      referenceId: orderId,
      onHandBefore,
      userId,
    });

    // 3. Persist the order (snapshot of the recipe as resolved) …
    const assemblyNumber = await this.numbering.generateNumber(
      'ASSEMBLY',
      undefined,
      tx,
    );
    await tx.assemblyOrder.create({
      data: {
        id: orderId,
        assemblyNumber,
        productId: plan.product.id,
        warehouseId: dto.warehouseId,
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        recipeSnapshot: recipeSnapshot(recipe, plan.lines),
        quantity: dto.quantity,
        ownerAgentId,
        componentCost: cost.componentCost,
        directCost: cost.directCost,
        totalCost: cost.totalCost,
        unitCost: cost.unitCost,
        outputMovementId: output.id,
        idempotencyKey: key,
        status: AssemblyStatus.POSTED,
        notes: dto.notes?.trim() || null,
        createdBy: userId,
        lines: {
          create: cost.lines.map((line) => ({
            componentProductId: line.componentProductId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            value: line.value,
            consumptionMovementId:
              consumptionIds.get(line.componentProductId) ?? null,
          })),
        },
      },
    });

    // 4. … and post the journal (company stock only) in the same transaction.
    if (!ownerAgentId) {
      await this.postingEngine.post(REFERENCE_TYPE, orderId, userId, tx);
    }
    await this.activities.log(
      plan.product.id,
      AssemblyActivityType.ASSEMBLY_POSTED,
      `Assembled ${dto.quantity} × ${label(plan.product)} (${assemblyNumber}) from recipe version ${recipe.version}`,
      {
        assemblyOrderId: orderId,
        assemblyNumber,
        quantity: dto.quantity,
        totalCost: cost.totalCost.toString(),
      },
      tx,
    );
    return { order: await this.loadOrder(tx, orderId), replayed: false };
  }

  /** Direct cost rules: none for agent stock; otherwise a permission, and the credit account must be configured (fail closed). */
  private async assertDirectCostAllowed(
    tx: Prisma.TransactionClient,
    directCost: Prisma.Decimal,
    ownerAgentId: string | null,
    userId: string,
  ): Promise<void> {
    if (directCost.lte(0)) return;
    if (ownerAgentId) {
      throw unprocessable(
        'ASSEMBLY_AGENT_DIRECT_COST',
        'Agent-owned stock is assembled without a direct cost — it never reaches the company ledger.',
      );
    }
    if (
      !(await this.permissions.hasPermission(userId, DIRECT_COST_PERMISSION))
    ) {
      throw new ForbiddenException({
        code: 'ASSEMBLY_DIRECT_COST_FORBIDDEN',
        message: `Entering a direct cost requires the permission "${DIRECT_COST_PERMISSION}".`,
      });
    }
    const settings = await tx.postingSettings.findFirst({
      select: { assemblyCostAccountId: true },
    });
    if (!settings?.assemblyCostAccountId) {
      throw unprocessable(
        'ASSEMBLY_COST_ACCOUNT_MISSING',
        'A direct cost needs the Assembly Cost account — set it in Accounting Settings first.',
      );
    }
  }

  // ------------------------------------------------------------------ reverse

  /**
   * Reverses a POSTED assembly (reason required): the finished quantity must
   * still be available in the warehouse (409 `ASSEMBLY_OUTPUT_CONSUMED`
   * otherwise); it is removed at its recorded value, each component returns at
   * the unit cost recorded on its order line, and the journal is reversed through
   * the Posting Engine. Nothing is deleted.
   */
  reverse(
    id: string,
    dto: ReverseAssemblyDto,
    userId: string,
    includeCosts: boolean,
  ): Promise<AssemblyOrderView> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.requireOrder(tx, id);
      await lockProductsForUpdate(tx, [
        found.productId,
        ...found.lines.map((line) => line.componentProductId),
      ]);
      const order = await this.requireOrder(tx, id);
      if (order.status !== AssemblyStatus.POSTED) {
        throw conflict(
          'ASSEMBLY_NOT_POSTED',
          `Assembly ${order.assemblyNumber} is already reversed.`,
        );
      }

      const finished = (
        await readStockAvailability(tx, [order.productId], order.warehouseId)
      ).get(order.productId);
      const available = finished?.available ?? 0;
      if (available < order.quantity) {
        throw conflict(
          'ASSEMBLY_OUTPUT_CONSUMED',
          `${label(order.product)} from ${order.assemblyNumber} is no longer in stock (needed ${order.quantity}, available ${available} in ${order.warehouse.code}) — use the scrap or return flows instead.`,
          { required: order.quantity, available },
        );
      }

      const onHandBefore = await this.valuation.getOnHandQuantity(
        tx,
        order.productId,
      );
      await this.inventory.postProductionMovement(tx, {
        type: 'PRODUCTION_OUTPUT',
        productId: order.productId,
        warehouseId: order.warehouseId,
        quantity: -order.quantity,
        referenceType: REFERENCE_TYPE,
        referenceId: order.id,
        idempotencyKey: `${REFERENCE_TYPE}:${order.id}:${order.productId}:PRODUCTION_OUTPUT:REVERSAL`,
        unitCost: order.unitCost,
        recipeId: order.recipeId,
        notes: dto.reason,
        userId,
      });
      await this.valuation.applyAssemblyReversal(tx, {
        productId: order.productId,
        quantityRemoved: order.quantity,
        removedValue: order.totalCost,
        referenceId: order.id,
        onHandBefore,
        userId,
      });

      for (const line of order.lines) {
        const componentOnHand = await this.valuation.getOnHandQuantity(
          tx,
          line.componentProductId,
        );
        const movement = await this.inventory.postProductionMovement(tx, {
          type: 'PRODUCTION_CONSUMPTION',
          productId: line.componentProductId,
          warehouseId: order.warehouseId,
          quantity: line.quantity,
          referenceType: REFERENCE_TYPE,
          referenceId: order.id,
          idempotencyKey: `${REFERENCE_TYPE}:${order.id}:${line.componentProductId}:PRODUCTION_CONSUMPTION:REVERSAL`,
          unitCost: line.unitCost,
          parentProductId: order.productId,
          recipeId: order.recipeId,
          notes: dto.reason,
          userId,
        });
        await this.assemblyCost.returnComponentToAverage(tx, {
          productId: line.componentProductId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          onHandBefore: componentOnHand,
          referenceId: order.id,
          userId,
        });
        await tx.assemblyOrderLine.update({
          where: { id: line.id },
          data: { reversalMovementId: movement.id },
        });
      }

      if (!order.ownerAgentId) {
        await this.postingEngine.reverse(REFERENCE_TYPE, order.id, userId, tx);
      }
      await tx.assemblyOrder.update({
        where: { id: order.id },
        data: {
          status: AssemblyStatus.REVERSED,
          reversedAt: new Date(),
          reversedBy: userId,
          reversalReason: dto.reason,
        },
      });
      await this.activities.log(
        order.productId,
        AssemblyActivityType.ASSEMBLY_REVERSED,
        `Assembly ${order.assemblyNumber} reversed: ${dto.reason}`,
        { assemblyOrderId: order.id, reason: dto.reason },
        tx,
      );
      return toView(await this.loadOrder(tx, order.id), includeCosts);
    }, TRANSACTION_OPTIONS);
  }

  // -------------------------------------------------------------------- reads

  async findAll(query: ListAssemblyQueryDto, includeCosts: boolean) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.AssemblyOrderWhereInput = {
      productId: query.productId,
      status: query.status,
      createdAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? endOfRange(query.to) : undefined,
      },
    };
    const [rows, total] = await Promise.all([
      this.prisma.assemblyOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.assemblyOrder.count({ where }),
    ]);
    return {
      items: rows.map((row) => toView(row, includeCosts)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string, includeCosts: boolean): Promise<AssemblyOrderView> {
    return toView(await this.requireOrder(this.prisma, id), includeCosts);
  }

  // ---------------------------------------------------------------- internals

  /**
   * Everything an assembly of `quantity` units needs, plus the reasons it cannot
   * happen (blockers). Read-only: the preview shows the blockers, `create` throws
   * the first one — so what the screen says and what the operation enforces can
   * never drift apart.
   */
  private async buildPlan(
    client: Client,
    input: { productId: string; warehouseId: string; quantity: number },
  ): Promise<AssemblyPlan> {
    const [product, warehouse] = await Promise.all([
      client.product.findFirst({
        where: { id: input.productId, deletedAt: null },
        select: {
          id: true,
          sku: true,
          name: true,
          status: true,
          isInventoryItem: true,
          supplyMethod: true,
          ownerAgentId: true,
        },
      }),
      client.warehouse.findUnique({
        where: { id: input.warehouseId },
        select: { id: true, code: true, isActive: true },
      }),
    ]);
    if (!product) {
      throw notFound('PRODUCT_NOT_FOUND', 'The product does not exist.');
    }
    if (!warehouse) {
      throw notFound('WAREHOUSE_NOT_FOUND', 'The warehouse does not exist.');
    }
    const blockers: AssemblyBlocker[] = [];
    const plan = (recipe: LoadedRecipe | null, lines: PlanLine[]) => ({
      blockers,
      product,
      recipe,
      lines,
    });

    if (!warehouse.isActive) {
      blockers.push({
        code: 'ASSEMBLY_WAREHOUSE_INACTIVE',
        message: `Warehouse ${warehouse.code} is inactive.`,
      });
    }
    if (!isAssemblable(product)) {
      blockers.push({
        code: 'ASSEMBLY_NOT_ASSEMBLED_PRODUCT',
        message: `${label(product)} is not an active, stock-tracked assembled product.`,
      });
      return plan(null, []);
    }
    const recipe = await this.recipes.getActiveRecipe(client, product.id);
    if (!recipe) {
      blockers.push({
        code: 'ASSEMBLY_NO_ACTIVE_RECIPE',
        message: `${label(product)} has no active recipe.`,
      });
      return plan(null, []);
    }
    const mixed = ownerViolation(
      {
        id: product.id,
        label: label(product),
        ownerAgentId: product.ownerAgentId,
      },
      recipe.lines.map((line) => ({
        id: line.componentProductId,
        label: label(line.componentProduct),
        ownerAgentId: line.componentProduct.ownerAgentId,
      })),
    );
    if (mixed) {
      blockers.push({ code: 'ASSEMBLY_OWNER_MIXED', message: mixed });
      return plan(recipe, []);
    }

    let resolved: Awaited<ReturnType<RecipeService['resolveStockQuantities']>>;
    try {
      resolved = await this.recipes.resolveStockQuantities(
        client,
        recipe,
        this.recipes.runsFor(recipe, input.quantity),
      );
    } catch (error) {
      const code = errorCode(error);
      if (
        error instanceof HttpException &&
        (code === 'ASSEMBLY_FRACTIONAL_CONSUMPTION' ||
          code === 'RECIPE_UNIT_CONVERSION_MISSING')
      ) {
        blockers.push({
          code,
          message: (error.getResponse() as { message: string }).message,
        });
        return plan(recipe, []);
      }
      throw error;
    }

    const stock = await readStockAvailability(
      client,
      resolved.map((line) => line.componentProductId),
      input.warehouseId,
    );
    const lines: PlanLine[] = [];
    for (const line of resolved) {
      const unitCost = await this.valuation.getUnitCostDecimal(
        line.componentProductId,
        client,
      );
      lines.push({
        componentProductId: line.componentProductId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        available: stock.get(line.componentProductId)?.available ?? 0,
        unitCost,
        value: round2(unitCost.mul(line.quantity)),
        recipeQuantity: line.recipeQuantity,
        unitId: line.unitId,
        quantityPerRun: line.quantityPerRun,
      });
    }

    const shortages = lines.filter((line) => line.available < line.quantity);
    if (shortages.length > 0) {
      blockers.push({
        code: 'ASSEMBLY_INSUFFICIENT_STOCK',
        message:
          `Not enough stock in ${warehouse.code} to assemble ${input.quantity} × ${label(product)}: ` +
          shortages
            .map(
              (line) =>
                `${line.sku} ${line.name} needs ${line.quantity}, available ${line.available}`,
            )
            .join('; ') +
          '.',
        details: {
          shortages: shortages.map((line) => ({
            productId: line.componentProductId,
            sku: line.sku,
            name: line.name,
            required: line.quantity,
            available: line.available,
          })),
        },
      });
    }
    return plan(recipe, lines);
  }

  private findByKey(client: Client, key: string) {
    return client.assemblyOrder.findUnique({
      where: { idempotencyKey: key },
      include: ORDER_INCLUDE,
    });
  }

  /** The same key with a different request is a client bug — never answer it with an unrelated order. */
  private assertSameRequest(
    existing: LoadedOrder,
    dto: CreateAssemblyDto,
  ): LoadedOrder {
    if (
      existing.productId !== dto.productId ||
      existing.warehouseId !== dto.warehouseId ||
      existing.quantity !== dto.quantity
    ) {
      throw conflict(
        'ASSEMBLY_IDEMPOTENCY_MISMATCH',
        'This idempotency key was already used for a different assembly request.',
      );
    }
    return existing;
  }

  private loadOrder(client: Client, id: string) {
    return client.assemblyOrder.findUniqueOrThrow({
      where: { id },
      include: ORDER_INCLUDE,
    });
  }

  private async requireOrder(client: Client, id: string) {
    const order = await client.assemblyOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw notFound(
        'ASSEMBLY_NOT_FOUND',
        'The assembly order does not exist.',
      );
    }
    return order;
  }
}

function isAssemblable(product: {
  status: ProductStatus;
  isInventoryItem: boolean;
  supplyMethod: ProductSupplyMethod;
}): boolean {
  return (
    product.supplyMethod === ProductSupplyMethod.ASSEMBLED &&
    product.isInventoryItem &&
    product.status === 'ACTIVE'
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/** `to=2026-10-05` covers the whole day; a full timestamp is taken as is. */
function endOfRange(value: string): Date {
  return value.length === 10
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
}

/** The recipe as it was resolved for this order: what a later edit can never rewrite. */
function recipeSnapshot(
  recipe: LoadedRecipe,
  lines: PlanLine[],
): Prisma.InputJsonValue {
  return {
    recipeId: recipe.id,
    version: recipe.version,
    outputQuantity: recipe.outputQuantity.toString(),
    directCostEstimate: recipe.directCostEstimate.toString(),
    lines: lines.map((line) => ({
      componentProductId: line.componentProductId,
      sku: line.sku,
      name: line.name,
      quantity: line.recipeQuantity.toString(),
      unitId: line.unitId,
      stockQuantityPerRun: line.quantityPerRun.toString(),
      stockQuantity: line.quantity,
    })),
  };
}

export function toView(
  order: LoadedOrder,
  includeCosts: boolean,
): AssemblyOrderView {
  const show = (value: Prisma.Decimal) =>
    includeCosts ? value.toString() : null;
  return {
    id: order.id,
    assemblyNumber: order.assemblyNumber,
    status: order.status,
    productId: order.productId,
    product: order.product,
    warehouseId: order.warehouseId,
    warehouse: order.warehouse,
    recipeId: order.recipeId,
    recipeVersion: order.recipeVersion,
    recipeSnapshot: order.recipeSnapshot,
    quantity: order.quantity,
    ownerAgentId: order.ownerAgentId,
    componentCost: show(order.componentCost),
    directCost: show(order.directCost),
    totalCost: show(order.totalCost),
    unitCost: show(order.unitCost),
    lines: order.lines.map((line) => ({
      id: line.id,
      componentProductId: line.componentProductId,
      componentSku: line.componentProduct.sku,
      componentName: line.componentProduct.name,
      quantity: line.quantity,
      unitCost: show(line.unitCost),
      value: show(line.value),
      consumptionMovementId: line.consumptionMovementId,
      reversalMovementId: line.reversalMovementId,
    })),
    outputMovementId: order.outputMovementId,
    notes: order.notes,
    createdAt: order.createdAt,
    createdBy: order.createdBy,
    reversedAt: order.reversedAt,
    reversedBy: order.reversedBy,
    reversalReason: order.reversalReason,
  };
}
