import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, ProductSupplyMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnitConversionService } from '../units/unit-conversion.service';
import { unprocessable } from '../common/errors/business-errors';
import { toWholeUnits } from './recipe-rules';

type Client = Prisma.TransactionClient | PrismaService;

/** The product columns a recipe line needs about its component. */
const COMPONENT_SELECT = {
  id: true,
  sku: true,
  name: true,
  unitId: true,
  status: true,
  deletedAt: true,
  isInventoryItem: true,
  itemType: true,
  supplyMethod: true,
  ownerAgentId: true,
  categoryId: true,
  currentCost: true,
} satisfies Prisma.ProductSelect;

/** A recipe with its finished product and every line (component + unit) — the one shape every consumer reads. */
export const RECIPE_INCLUDE = {
  product: {
    select: {
      id: true,
      sku: true,
      name: true,
      supplyMethod: true,
      ownerAgentId: true,
      categoryId: true,
      status: true,
      deletedAt: true,
      isInventoryItem: true,
      itemType: true,
    },
  },
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: {
      componentProduct: { select: COMPONENT_SELECT },
      unit: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ProductRecipeInclude;

export type LoadedRecipe = Prisma.ProductRecipeGetPayload<{
  include: typeof RECIPE_INCLUDE;
}>;

/** One recipe line expressed in the component's own stock unit. */
export interface RecipeLineStockQuantity {
  componentProductId: string;
  sku: string;
  name: string;
  /** The quantity as written on the recipe line (recipe unit). */
  recipeQuantity: Prisma.Decimal;
  unitId: string;
  /** The component's stock unit — what the movements are counted in. */
  stockUnitId: string;
  /** Quantity per ONE recipe run in stock units (may be fractional). */
  quantityPerRun: Prisma.Decimal;
}

/** A recipe line for a concrete number of runs — a whole number of stock units. */
export interface ResolvedRecipeLine extends RecipeLineStockQuantity {
  quantity: number;
}

/**
 * Recipe reads for the stock-facing modules (assembly, kit sales): the ACTIVE
 * recipe of a product, and a recipe's lines converted into the components' stock
 * units for a number of runs. Writes live in `RecipeManagementService`.
 */
@Injectable()
export class RecipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitConversion: UnitConversionService,
  ) {}

  /** The product's ACTIVE recipe (at most one — partial unique index), or `null`. */
  getActiveRecipe(tx: Client, productId: string): Promise<LoadedRecipe | null> {
    return tx.productRecipe.findFirst({
      where: { productId, status: 'ACTIVE' },
      include: RECIPE_INCLUDE,
    });
  }

  /**
   * `producedQuantity ÷ outputQuantity` — how many recipe runs produce that many
   * finished units (a KIT recipe always has output 1, so runs = kits).
   */
  runsFor(
    recipe: Pick<LoadedRecipe, 'outputQuantity'>,
    producedQuantity: number,
  ): Prisma.Decimal {
    return new Prisma.Decimal(producedQuantity).div(recipe.outputQuantity);
  }

  /**
   * Every line of the recipe in the component's stock unit, per ONE run, with no
   * whole-number requirement (cost estimates, availability, activation checks).
   * A missing unit conversion throws 422 `UNIT_CONVERSION_MISSING` — units are
   * never silently mixed.
   */
  async resolvePerRunQuantities(
    tx: Client,
    recipe: Pick<LoadedRecipe, 'lines'>,
  ): Promise<RecipeLineStockQuantity[]> {
    const lines: RecipeLineStockQuantity[] = [];
    for (const line of recipe.lines) {
      const converted = await this.convertToStockUnit(tx, line);
      lines.push({
        componentProductId: line.componentProductId,
        sku: line.componentProduct.sku,
        name: line.componentProduct.name,
        recipeQuantity: line.quantity,
        unitId: line.unitId,
        stockUnitId: line.componentProduct.unitId,
        quantityPerRun: converted,
      });
    }
    return lines;
  }

  /** One line into the component's stock unit; a missing conversion names the component. */
  private async convertToStockUnit(
    tx: Client,
    line: LoadedRecipe['lines'][number],
  ): Promise<Prisma.Decimal> {
    try {
      return await this.unitConversion.convert(
        line.quantity,
        line.unitId,
        line.componentProduct.unitId,
        tx,
      );
    } catch (error) {
      const code =
        error instanceof HttpException
          ? (error.getResponse() as { code?: string }).code
          : undefined;
      if (code !== 'UNIT_CONVERSION_MISSING') throw error;
      throw unprocessable(
        'RECIPE_UNIT_CONVERSION_MISSING',
        `${line.componentProduct.sku} ${line.componentProduct.name}: no unit conversion exists between the recipe unit (${line.unit.name}) and the component's stock unit — add one under Unit Conversions first.`,
        {
          componentProductId: line.componentProductId,
          fromUnitId: line.unitId,
          toUnitId: line.componentProduct.unitId,
        },
      );
    }
  }

  /**
   * The lines for `runs` recipe runs, each a WHOLE number of stock units
   * (OMS adaptation, spec §3: no fractional stock). A fractional consumption is
   * rejected with 422 — `RECIPE_KIT_FRACTIONAL` for a kit,
   * `ASSEMBLY_FRACTIONAL_CONSUMPTION` for an assembled product — naming the line.
   */
  async resolveStockQuantities(
    tx: Client,
    recipe: Pick<LoadedRecipe, 'lines' | 'product'>,
    runs: Prisma.Decimal | string | number,
  ): Promise<ResolvedRecipeLine[]> {
    const multiplier = new Prisma.Decimal(runs);
    const isKit = recipe.product.supplyMethod === ProductSupplyMethod.KIT;
    const perRun = await this.resolvePerRunQuantities(tx, recipe);
    return perRun.map((line) => {
      const total = line.quantityPerRun.mul(multiplier);
      const quantity = toWholeUnits(total);
      if (quantity === null) {
        throw unprocessable(
          isKit ? 'RECIPE_KIT_FRACTIONAL' : 'ASSEMBLY_FRACTIONAL_CONSUMPTION',
          `${line.sku} ${line.name} would be consumed as ${total.toDecimalPlaces(6).toString()} units — ` +
            'stock is counted in whole units, so the quantity must come to a whole number.',
          {
            componentProductId: line.componentProductId,
            quantity: total.toDecimalPlaces(6).toString(),
          },
        );
      }
      return { ...line, quantity };
    });
  }
}
