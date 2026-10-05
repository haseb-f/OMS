import { Injectable } from '@nestjs/common';
import { Prisma, ProductSupplyMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { notFound, unprocessable } from '../common/errors/business-errors';
import {
  round2,
  round4,
} from '../accounting/inventory-valuation/inventory-valuation.service';
import { readStockAvailability } from '../inventory/stock-lines/stock-availability';
import { maximumAssemblableQuantity } from './recipe-rules';
import {
  RECIPE_INCLUDE,
  RecipeService,
  type LoadedRecipe,
} from './recipe.service';

export interface RecipeCostEstimate {
  recipeId: string;
  version: number;
  isEstimate: true;
  lines: {
    componentProductId: string;
    name: string;
    /** Component quantity per recipe run, in the component's stock unit. */
    quantityStock: string;
    unitCost: string | null;
    value: string | null;
  }[];
  componentsEstimate: string | null;
  directCostEstimate: string | null;
  totalEstimate: string | null;
  perUnitEstimate: string | null;
}

export interface KitAvailability {
  productId: string;
  supplyMethod: ProductSupplyMethod;
  /** Kits (KIT) or finished units (ASSEMBLED) that the component stock allows right now. */
  available: number;
  limiting: {
    productId: string;
    name: string;
    available: number;
    perKit: number;
  } | null;
  components: {
    productId: string;
    name: string;
    perKit: number;
    available: number;
  }[];
}

/**
 * Read-only recipe figures for the product page: the cost ESTIMATE (components'
 * current moving average — an estimate, every transaction stores its own actual
 * snapshot) and how many kits / assembled units the stock allows.
 */
@Injectable()
export class RecipeInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipeService,
  ) {}

  async costEstimate(
    productId: string,
    options: { recipeId?: string; includeCosts: boolean },
  ): Promise<RecipeCostEstimate> {
    const recipe = await this.requireRecipe(productId, options.recipeId);
    const perRun = await this.recipes.resolvePerRunQuantities(
      this.prisma,
      recipe,
    );
    const costById = new Map(
      recipe.lines.map((line) => [
        line.componentProductId,
        new Prisma.Decimal(line.componentProduct.currentCost ?? 0),
      ]),
    );

    const lines = perRun.map((line) => {
      const unitCost =
        costById.get(line.componentProductId) ?? new Prisma.Decimal(0);
      return {
        componentProductId: line.componentProductId,
        name: line.name,
        quantityStock: line.quantityPerRun.toString(),
        cost: unitCost,
        value: round2(unitCost.mul(line.quantityPerRun)),
      };
    });
    const componentsEstimate = lines.reduce(
      (sum, line) => sum.add(line.value),
      new Prisma.Decimal(0),
    );
    const totalEstimate = componentsEstimate.add(recipe.directCostEstimate);
    const show = (value: Prisma.Decimal) =>
      options.includeCosts ? value.toString() : null;

    return {
      recipeId: recipe.id,
      version: recipe.version,
      isEstimate: true,
      lines: lines.map((line) => ({
        componentProductId: line.componentProductId,
        name: line.name,
        quantityStock: line.quantityStock,
        unitCost: show(line.cost),
        value: show(line.value),
      })),
      componentsEstimate: show(componentsEstimate),
      directCostEstimate: show(recipe.directCostEstimate),
      totalEstimate: show(totalEstimate),
      perUnitEstimate: show(round4(totalEstimate.div(recipe.outputQuantity))),
    };
  }

  async availability(
    productId: string,
    warehouseId?: string,
  ): Promise<KitAvailability> {
    const recipe = await this.requireRecipe(productId);
    const supplyMethod = recipe.product.supplyMethod;
    if (
      supplyMethod !== ProductSupplyMethod.KIT &&
      supplyMethod !== ProductSupplyMethod.ASSEMBLED
    ) {
      throw unprocessable(
        'RECIPE_PRODUCT_NOT_ASSEMBLABLE',
        'Availability by components applies to kits and assembled products only.',
      );
    }
    const isKit = supplyMethod === ProductSupplyMethod.KIT;
    // Per ONE finished unit (one kit): a kit's recipe has output 1.
    const perRun = isKit
      ? (await this.recipes.resolveStockQuantities(this.prisma, recipe, 1)).map(
          (line) => ({
            ...line,
            quantityPerRun: new Prisma.Decimal(line.quantity),
          }),
        )
      : await this.recipes.resolvePerRunQuantities(this.prisma, recipe);
    const stock = await readStockAvailability(
      this.prisma,
      perRun.map((line) => line.componentProductId),
      warehouseId,
    );

    const components = perRun.map((line) => {
      const perUnit = line.quantityPerRun.div(recipe.outputQuantity);
      const available = stock.get(line.componentProductId)?.available ?? 0;
      return {
        productId: line.componentProductId,
        name: line.name,
        perUnit,
        perKit: perUnit.toNumber(),
        available,
        units: new Prisma.Decimal(Math.max(available, 0))
          .div(perUnit)
          .floor()
          .toNumber(),
      };
    });
    const limiting = components.reduce<(typeof components)[number] | null>(
      (lowest, item) => (!lowest || item.units < lowest.units ? item : lowest),
      null,
    );
    return {
      productId,
      supplyMethod,
      available: isKit
        ? (limiting?.units ?? 0)
        : maximumAssemblableQuantity(
            components.map((item) => ({
              perUnit: item.perUnit,
              available: item.available,
            })),
          ),
      limiting: limiting && {
        productId: limiting.productId,
        name: limiting.name,
        available: limiting.available,
        perKit: limiting.perKit,
      },
      components: components.map((item) => ({
        productId: item.productId,
        name: item.name,
        perKit: item.perKit,
        available: item.available,
      })),
    };
  }

  private async requireRecipe(
    productId: string,
    recipeId?: string,
  ): Promise<LoadedRecipe> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw notFound('PRODUCT_NOT_FOUND', 'The product does not exist.');
    }
    const recipe = recipeId
      ? await this.prisma.productRecipe.findFirst({
          where: { id: recipeId, productId },
          include: RECIPE_INCLUDE,
        })
      : await this.recipes.getActiveRecipe(this.prisma, productId);
    if (!recipe) {
      throw notFound(
        recipeId ? 'RECIPE_NOT_FOUND' : 'RECIPE_NO_ACTIVE',
        recipeId
          ? 'The recipe version does not exist for this product.'
          : 'The product has no active recipe.',
      );
    }
    return recipe;
  }
}
