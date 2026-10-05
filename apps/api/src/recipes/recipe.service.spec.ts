import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecipeService, type LoadedRecipe } from './recipe.service';
import type { UnitConversionService } from '../units/unit-conversion.service';
import type { PrismaService } from '../prisma/prisma.service';

const D = (value: string | number) => new Prisma.Decimal(value);

const line = (
  id: string,
  quantity: string,
  unitId: string,
  stockUnitId: string,
) =>
  ({
    componentProductId: id,
    quantity: D(quantity),
    unitId,
    unit: { id: unitId, name: unitId },
    componentProduct: {
      id,
      sku: `SKU-${id}`,
      name: `Name ${id}`,
      unitId: stockUnitId,
    },
  }) as unknown as LoadedRecipe['lines'][number];

const recipeOf = (
  supplyMethod: 'ASSEMBLED' | 'KIT',
  lines: LoadedRecipe['lines'],
) =>
  ({
    outputQuantity: D(1),
    product: { supplyMethod },
    lines,
  }) as unknown as LoadedRecipe;

/** box -> piece x12; every other pair is missing. */
const conversion = {
  convert: (
    quantity: Prisma.Decimal,
    from: string,
    to: string,
  ): Promise<Prisma.Decimal> => {
    if (from === to) return Promise.resolve(quantity);
    if (from === 'box' && to === 'pc') return Promise.resolve(quantity.mul(12));
    if (from === 'pc' && to === 'box') return Promise.resolve(quantity.div(12));
    return Promise.reject(
      new HttpException({ code: 'UNIT_CONVERSION_MISSING', message: 'x' }, 422),
    );
  },
} as unknown as UnitConversionService;

const service = new RecipeService({} as PrismaService, conversion);
const tx = {} as Prisma.TransactionClient;

const bodyOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as HttpException).getResponse() as {
      code: string;
      message: string;
    };
  }
  throw new Error('expected a rejection');
};

describe('RecipeService.resolveStockQuantities', () => {
  it('converts the recipe unit into the stock unit and multiplies by the runs', async () => {
    const recipe = recipeOf('ASSEMBLED', [line('a', '2', 'box', 'pc')]);
    const resolved = await service.resolveStockQuantities(tx, recipe, 3);
    expect(resolved[0].quantityPerRun.toString()).toBe('24');
    expect(resolved[0].quantity).toBe(72);
  });

  it('accepts a fractional number of runs when the consumption comes out whole', async () => {
    // 3 per run, 2 produced of an output-of-6 batch: runs = 1/3, consumption 1 unit.
    const recipe = recipeOf('ASSEMBLED', [line('a', '3', 'pc', 'pc')]);
    const runs = service.runsFor({ outputQuantity: D(6) }, 2);
    const resolved = await service.resolveStockQuantities(tx, recipe, runs);
    expect(resolved[0].quantity).toBe(1);
  });

  it('rejects a fractional consumption of an assembled product (ASSEMBLY_FRACTIONAL_CONSUMPTION)', async () => {
    const recipe = recipeOf('ASSEMBLED', [line('a', '1', 'pc', 'pc')]);
    const body = await bodyOf(
      service.resolveStockQuantities(tx, recipe, D(1).div(2)),
    );
    expect(body.code).toBe('ASSEMBLY_FRACTIONAL_CONSUMPTION');
    expect(body.message).toContain('SKU-a');
  });

  it('rejects a kit line that does not convert to whole stock units (RECIPE_KIT_FRACTIONAL)', async () => {
    // 1 piece against a component counted in boxes = 1/12 box: not a whole number of boxes.
    const recipe = recipeOf('KIT', [line('a', '1', 'pc', 'box')]);
    const body = await bodyOf(service.resolveStockQuantities(tx, recipe, 1));
    expect(body.code).toBe('RECIPE_KIT_FRACTIONAL');
  });

  it('names the component when no unit conversion exists (RECIPE_UNIT_CONVERSION_MISSING)', async () => {
    const recipe = recipeOf('ASSEMBLED', [line('a', '1', 'kg', 'pc')]);
    const body = await bodyOf(service.resolveStockQuantities(tx, recipe, 1));
    expect(body.code).toBe('RECIPE_UNIT_CONVERSION_MISSING');
    expect(body.message).toContain('SKU-a');
  });
});
