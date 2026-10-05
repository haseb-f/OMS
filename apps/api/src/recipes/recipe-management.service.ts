import { Injectable } from '@nestjs/common';
import { Prisma, ProductSupplyMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductActivityService } from '../products/activities/product-activity.service';
import { lockProductsForUpdate } from '../inventory/inventory.service';
import {
  conflict,
  notFound,
  unprocessable,
} from '../common/errors/business-errors';
import {
  CreateRecipeDto,
  RecipeLineDto,
  UpdateRecipeDto,
} from './dto/recipe.dto';
import {
  findRecipeCycle,
  ownerViolation,
  type OwnedProduct,
} from './recipe-rules';
import {
  RECIPE_INCLUDE,
  RecipeService,
  type LoadedRecipe,
} from './recipe.service';

/** Timeline entries written to the product's activity log. */
export const RecipeActivityType = {
  RECIPE_CREATED: 'RECIPE_CREATED',
  RECIPE_UPDATED: 'RECIPE_UPDATED',
  RECIPE_DELETED: 'RECIPE_DELETED',
  RECIPE_ACTIVATED: 'RECIPE_ACTIVATED',
  RECIPE_RETIRED: 'RECIPE_RETIRED',
} as const;

const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/** Serializes every recipe activation: a cycle is a property of the whole graph, so two concurrent activations must not both pass the walk. */
const ACTIVATION_LOCK_KEY = 'product_recipe_activation';

export interface RecipeLineView {
  id: string;
  componentProductId: string;
  componentName: string;
  componentSku: string;
  quantity: string;
  unitId: string;
  unitName: string;
  sortOrder: number;
}

export interface RecipeView {
  id: string;
  productId: string;
  version: number;
  status: LoadedRecipe['status'];
  effectiveFrom: Date | null;
  outputQuantity: string;
  directCostEstimate: string;
  notes: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  retiredAt: Date | null;
  lines: RecipeLineView[];
}

export function toRecipeView(recipe: LoadedRecipe): RecipeView {
  return {
    id: recipe.id,
    productId: recipe.productId,
    version: recipe.version,
    status: recipe.status,
    effectiveFrom: recipe.effectiveFrom,
    outputQuantity: recipe.outputQuantity.toString(),
    directCostEstimate: recipe.directCostEstimate.toString(),
    notes: recipe.notes,
    createdAt: recipe.createdAt,
    activatedAt: recipe.activatedAt,
    retiredAt: recipe.retiredAt,
    lines: recipe.lines.map((line) => ({
      id: line.id,
      componentProductId: line.componentProductId,
      componentName: line.componentProduct.name,
      componentSku: line.componentProduct.sku,
      quantity: line.quantity.toString(),
      unitId: line.unitId,
      unitName: line.unit.name,
      sortOrder: line.sortOrder,
    })),
  };
}

const label = (product: { sku: string; name: string }) =>
  `${product.sku} ${product.name}`;

/**
 * Recipe versions: DRAFT is editable, ACTIVE / RETIRED are immutable (an edit is
 * a new version via `copyFromRecipeId`). Activation validates the whole recipe
 * (spec §3) and swaps the ACTIVE version in ONE transaction.
 */
@Injectable()
export class RecipeManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipeService,
    private readonly activities: ProductActivityService,
  ) {}

  async list(productId: string): Promise<RecipeView[]> {
    await this.requireProduct(this.prisma, productId);
    const rows = await this.prisma.productRecipe.findMany({
      where: { productId },
      orderBy: { version: 'desc' },
      include: RECIPE_INCLUDE,
    });
    return rows.map(toRecipeView);
  }

  create(
    productId: string,
    dto: CreateRecipeDto,
    userId?: string,
  ): Promise<RecipeView> {
    return this.prisma.$transaction(async (tx) => {
      await lockProductsForUpdate(tx, [productId]);
      await this.requireProduct(tx, productId);

      const source = dto.copyFromRecipeId
        ? await tx.productRecipe.findFirst({
            where: { id: dto.copyFromRecipeId, productId },
            include: RECIPE_INCLUDE,
          })
        : null;
      if (dto.copyFromRecipeId && !source) {
        throw notFound(
          'RECIPE_COPY_SOURCE_NOT_FOUND',
          'The recipe version to copy does not exist for this product.',
        );
      }
      const lines =
        dto.lines ??
        source?.lines.map((line) => ({
          componentProductId: line.componentProductId,
          quantity: line.quantity.toString(),
          unitId: line.unitId,
        })) ??
        [];
      const lineData = await this.normalizeLines(tx, productId, lines);

      const latest = await tx.productRecipe.aggregate({
        where: { productId },
        _max: { version: true },
      });
      const created = await tx.productRecipe.create({
        data: {
          productId,
          version: (latest._max.version ?? 0) + 1,
          outputQuantity: dto.outputQuantity ?? source?.outputQuantity ?? 1,
          directCostEstimate:
            dto.directCostEstimate ?? source?.directCostEstimate ?? 0,
          notes: dto.notes ?? source?.notes ?? null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          lines: { create: lineData },
        },
        include: RECIPE_INCLUDE,
      });
      await this.activities.log(
        productId,
        RecipeActivityType.RECIPE_CREATED,
        `Recipe version ${created.version} created (draft)`,
        { recipeId: created.id, version: created.version },
        tx,
      );
      return toRecipeView(created);
    }, TRANSACTION_OPTIONS);
  }

  update(
    id: string,
    dto: UpdateRecipeDto,
    userId?: string,
  ): Promise<RecipeView> {
    return this.prisma.$transaction(async (tx) => {
      const recipe = await this.lockAndLoadDraft(tx, id);
      const lineData = dto.lines
        ? await this.normalizeLines(tx, recipe.productId, dto.lines)
        : null;
      if (lineData) {
        await tx.productRecipeLine.deleteMany({ where: { recipeId: id } });
      }
      const updated = await tx.productRecipe.update({
        where: { id },
        data: {
          outputQuantity: dto.outputQuantity,
          directCostEstimate: dto.directCostEstimate,
          notes: dto.notes,
          updatedBy: userId ?? null,
          ...(lineData ? { lines: { create: lineData } } : {}),
        },
        include: RECIPE_INCLUDE,
      });
      await this.activities.log(
        recipe.productId,
        RecipeActivityType.RECIPE_UPDATED,
        `Recipe version ${recipe.version} (draft) updated`,
        { recipeId: id, version: recipe.version },
        tx,
      );
      return toRecipeView(updated);
    }, TRANSACTION_OPTIONS);
  }

  remove(id: string, userId?: string): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const recipe = await this.lockAndLoadDraft(tx, id);
      await tx.productRecipe.delete({ where: { id } });
      await this.activities.log(
        recipe.productId,
        RecipeActivityType.RECIPE_DELETED,
        `Recipe version ${recipe.version} (draft) deleted`,
        { recipeId: id, version: recipe.version, deletedBy: userId ?? null },
        tx,
      );
      return { id };
    }, TRANSACTION_OPTIONS);
  }

  activate(id: string, userId?: string): Promise<RecipeView> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ACTIVATION_LOCK_KEY}), 0)::text AS locked`;
      const recipe = await this.lockAndLoadDraft(tx, id);
      await this.assertActivatable(tx, recipe);

      const now = new Date();
      const previous = await tx.productRecipe.findFirst({
        where: { productId: recipe.productId, status: 'ACTIVE' },
        select: { id: true, version: true },
      });
      await tx.productRecipe.updateMany({
        where: { productId: recipe.productId, status: 'ACTIVE' },
        data: { status: 'RETIRED', retiredAt: now },
      });
      let activated: LoadedRecipe;
      try {
        activated = await tx.productRecipe.update({
          where: { id },
          data: {
            status: 'ACTIVE',
            effectiveFrom: now,
            activatedAt: now,
            activatedBy: userId ?? null,
            updatedBy: userId ?? null,
          },
          include: RECIPE_INCLUDE,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw conflict(
            'RECIPE_ACTIVE_CONFLICT',
            'Another recipe version of this product was activated at the same moment — reload and try again.',
          );
        }
        throw error;
      }
      await this.activities.log(
        recipe.productId,
        RecipeActivityType.RECIPE_ACTIVATED,
        previous
          ? `Recipe version ${recipe.version} activated (replaces version ${previous.version})`
          : `Recipe version ${recipe.version} activated`,
        {
          recipeId: id,
          version: recipe.version,
          previousRecipeId: previous?.id ?? null,
          previousVersion: previous?.version ?? null,
        },
        tx,
      );
      return toRecipeView(activated);
    }, TRANSACTION_OPTIONS);
  }

  retire(id: string, userId?: string): Promise<RecipeView> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.requireRecipe(tx, id);
      await lockProductsForUpdate(tx, [found.productId]);
      const recipe = await this.requireRecipe(tx, id);
      if (recipe.status !== 'ACTIVE') {
        throw conflict(
          'RECIPE_NOT_ACTIVE',
          'Only the active recipe version can be retired.',
        );
      }
      const retired = await tx.productRecipe.update({
        where: { id },
        data: {
          status: 'RETIRED',
          retiredAt: new Date(),
          updatedBy: userId ?? null,
        },
        include: RECIPE_INCLUDE,
      });
      await this.activities.log(
        recipe.productId,
        RecipeActivityType.RECIPE_RETIRED,
        `Recipe version ${recipe.version} retired`,
        { recipeId: id, version: recipe.version },
        tx,
      );
      return toRecipeView(retired);
    }, TRANSACTION_OPTIONS);
  }

  // ---------------------------------------------------------------- internals

  private async requireProduct(
    client: Prisma.TransactionClient | PrismaService,
    productId: string,
  ) {
    const product = await client.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw notFound('PRODUCT_NOT_FOUND', 'The product does not exist.');
    }
    return product;
  }

  private async requireRecipe(tx: Prisma.TransactionClient, id: string) {
    const recipe = await tx.productRecipe.findUnique({
      where: { id },
      include: RECIPE_INCLUDE,
    });
    if (!recipe) {
      throw notFound('RECIPE_NOT_FOUND', 'The recipe does not exist.');
    }
    return recipe;
  }

  /** Locks the recipe's product, then re-reads the recipe: only a DRAFT may change, and the status is checked under the lock. */
  private async lockAndLoadDraft(tx: Prisma.TransactionClient, id: string) {
    const found = await this.requireRecipe(tx, id);
    await lockProductsForUpdate(tx, [found.productId]);
    const recipe = await this.requireRecipe(tx, id);
    if (recipe.status !== 'DRAFT') {
      throw conflict(
        'RECIPE_IMMUTABLE',
        'Only a draft recipe can be changed — activated and retired versions are immutable. Create a new version from it instead.',
        { status: recipe.status },
      );
    }
    return recipe;
  }

  /** Draft-level line checks: real, non-deleted components and units, no duplicate component, never the product itself. */
  private async normalizeLines(
    tx: Prisma.TransactionClient,
    productId: string,
    lines: RecipeLineDto[],
  ): Promise<Prisma.ProductRecipeLineUncheckedCreateWithoutRecipeInput[]> {
    const componentIds = lines.map((line) => line.componentProductId);
    if (new Set(componentIds).size !== componentIds.length) {
      throw unprocessable(
        'RECIPE_DUPLICATE_COMPONENT',
        'A component can appear only once in a recipe — merge the quantities into one line.',
      );
    }
    if (componentIds.includes(productId)) {
      throw unprocessable(
        'RECIPE_CYCLE',
        'A product cannot be a component of its own recipe.',
      );
    }
    const unitIds = [...new Set(lines.map((line) => line.unitId))];
    const [products, units] = await Promise.all([
      tx.product.findMany({
        where: { id: { in: componentIds }, deletedAt: null },
        select: { id: true },
      }),
      tx.unit.findMany({
        where: { id: { in: unitIds }, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (products.length !== componentIds.length) {
      throw unprocessable(
        'RECIPE_COMPONENT_NOT_FOUND',
        'A component product does not exist or has been archived.',
      );
    }
    if (units.length !== unitIds.length) {
      throw unprocessable(
        'RECIPE_UNIT_NOT_FOUND',
        'A recipe line uses a unit that does not exist.',
      );
    }
    return lines.map((line, index) => ({
      componentProductId: line.componentProductId,
      quantity: line.quantity,
      unitId: line.unitId,
      sortOrder: index,
    }));
  }

  /** Every activation rule of spec §3 — throws the first violation (422 `code`). */
  private async assertActivatable(
    tx: Prisma.TransactionClient,
    recipe: LoadedRecipe,
  ): Promise<void> {
    const product = recipe.product;
    const isKit = product.supplyMethod === ProductSupplyMethod.KIT;
    if (
      product.deletedAt ||
      (product.supplyMethod !== ProductSupplyMethod.ASSEMBLED && !isKit)
    ) {
      throw unprocessable(
        'RECIPE_PRODUCT_NOT_ASSEMBLABLE',
        `${label(product)} is neither an assembled product nor a kit — set its supply method first.`,
      );
    }
    if (recipe.lines.length === 0) {
      throw unprocessable(
        'RECIPE_EMPTY',
        'A recipe needs at least one component line.',
      );
    }
    if (isKit && !recipe.outputQuantity.eq(1)) {
      throw unprocessable(
        'RECIPE_KIT_OUTPUT',
        'A kit recipe yields exactly one kit per run — its output quantity must be 1.',
      );
    }

    for (const { componentProduct: component } of recipe.lines) {
      if (component.supplyMethod === ProductSupplyMethod.KIT) {
        throw unprocessable(
          'RECIPE_NESTED_KIT',
          `${label(component)} is a kit — a kit cannot be a component of another recipe.`,
        );
      }
      if (component.deletedAt || component.status !== 'ACTIVE') {
        throw unprocessable(
          'RECIPE_COMPONENT_INACTIVE',
          `${label(component)} is inactive or archived — it cannot be a component.`,
        );
      }
      if (component.itemType === 'SERVICE' || !component.isInventoryItem) {
        throw unprocessable(
          'RECIPE_COMPONENT_NOT_STOCKED',
          `${label(component)} is not a stock-tracked product — only stocked products can be components.`,
        );
      }
    }

    const owned = (item: {
      id: string;
      sku: string;
      name: string;
      ownerAgentId: string | null;
    }): OwnedProduct => ({
      id: item.id,
      label: label(item),
      ownerAgentId: item.ownerAgentId,
    });
    const mixed = ownerViolation(
      owned(product),
      recipe.lines.map((line) => owned(line.componentProduct)),
    );
    if (mixed) throw unprocessable('RECIPE_OWNER_MIXED', mixed);

    // Throws RECIPE_UNIT_CONVERSION_MISSING, and for a kit RECIPE_KIT_FRACTIONAL.
    if (isKit) await this.recipes.resolveStockQuantities(tx, recipe, 1);
    else await this.recipes.resolvePerRunQuantities(tx, recipe);

    await this.assertAcyclic(tx, recipe);
  }

  private async assertAcyclic(
    tx: Prisma.TransactionClient,
    recipe: LoadedRecipe,
  ): Promise<void> {
    const componentIds = recipe.lines.map((line) => line.componentProductId);
    const edges = await this.loadActiveEdges(tx, componentIds);
    const cycle = findRecipeCycle(recipe.productId, componentIds, edges);
    if (!cycle) return;
    const names = await tx.product.findMany({
      where: { id: { in: cycle } },
      select: { id: true, sku: true, name: true },
    });
    const byId = new Map(names.map((item) => [item.id, label(item)]));
    const path = cycle.map((id) => byId.get(id) ?? id).join(' → ');
    throw unprocessable(
      'RECIPE_CYCLE',
      `This recipe would make a product part of itself: ${path}.`,
      { path: cycle },
    );
  }

  /** The components of every ACTIVE recipe reachable from the starting products (breadth-first, one query per level). */
  private async loadActiveEdges(
    tx: Prisma.TransactionClient,
    startIds: string[],
  ): Promise<Map<string, string[]>> {
    const edges = new Map<string, string[]>();
    const seen = new Set(startIds);
    let frontier = [...seen];
    while (frontier.length > 0) {
      const rows = await tx.productRecipe.findMany({
        where: { productId: { in: frontier }, status: 'ACTIVE' },
        select: {
          productId: true,
          lines: { select: { componentProductId: true } },
        },
      });
      const next: string[] = [];
      for (const row of rows) {
        const components = row.lines.map((line) => line.componentProductId);
        edges.set(row.productId, components);
        for (const component of components) {
          if (!seen.has(component)) {
            seen.add(component);
            next.push(component);
          }
        }
      }
      frontier = next;
    }
    return edges;
  }
}
