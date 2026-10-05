import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UnitConversionService } from './unit-conversion.service';

const BOX = 'unit-box';
const PIECE = 'unit-piece';
const DOZEN = 'unit-dozen';

type Row = {
  fromUnitId: string;
  toUnitId: string;
  conversionRatio: Prisma.Decimal;
};

function build(rows: Row[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { unitConversion: { findMany } };
  return {
    service: new UnitConversionService(prisma as never),
    findMany,
  };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    return (error as UnprocessableEntityException).getResponse() as {
      code: string;
    };
  }
  throw new Error('expected a rejection');
}

describe('UnitConversionService', () => {
  const boxToPiece: Row = {
    fromUnitId: BOX,
    toUnitId: PIECE,
    conversionRatio: new Prisma.Decimal('12'),
  };

  it('is the identity for the same unit and never touches the database', async () => {
    const { service, findMany } = build([]);
    const result = await service.convert('3.5', BOX, BOX);
    expect(result.toString()).toBe('3.5');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('multiplies by the ratio of a direct row', async () => {
    const { service } = build([boxToPiece]);
    expect((await service.convert(2, BOX, PIECE)).toString()).toBe('24');
    expect(
      (await service.convert(new Prisma.Decimal('0.5'), BOX, PIECE)).toString(),
    ).toBe('6');
  });

  it('divides by the ratio when only the inverse row exists', async () => {
    const { service } = build([boxToPiece]);
    expect((await service.convert(36, PIECE, BOX)).toString()).toBe('3');
    // 1 piece = 1/12 box — exact decimal arithmetic, never a float
    const oneTwelfth = await service.convert('1', PIECE, BOX);
    expect(oneTwelfth.mul(12).toDecimalPlaces(10).toString()).toBe('1');
  });

  it('only asks for active, non-deleted conversions in either direction', async () => {
    const { service, findMany } = build([boxToPiece]);
    await service.convert(1, BOX, PIECE);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          deletedAt: null,
          OR: [
            { fromUnitId: BOX, toUnitId: PIECE },
            { fromUnitId: PIECE, toUnitId: BOX },
          ],
        },
      }),
    );
  });

  it('throws 422 UNIT_CONVERSION_MISSING when no direct row exists (never chains hops)', async () => {
    // BOX→PIECE and PIECE→DOZEN would chain to BOX→DOZEN: still not allowed.
    const { service } = build([]);
    expect(await codeOf(service.convert(1, BOX, DOZEN))).toMatchObject({
      code: 'UNIT_CONVERSION_MISSING',
    });
  });

  it('treats a non-positive stored ratio as missing instead of dividing by zero', async () => {
    const { service } = build([
      { ...boxToPiece, conversionRatio: new Prisma.Decimal('0') },
    ]);
    expect(await codeOf(service.convert(1, PIECE, BOX))).toMatchObject({
      code: 'UNIT_CONVERSION_MISSING',
    });
    expect(await codeOf(service.convert(1, BOX, PIECE))).toMatchObject({
      code: 'UNIT_CONVERSION_MISSING',
    });
  });
});
