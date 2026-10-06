import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Converts a quantity between two units through ONE direct `UnitConversion`
 * row (R13 spec §3). Never chains hops (A→B→C) and never silently assumes a
 * ratio: a missing conversion is a 422 `UNIT_CONVERSION_MISSING`, so a recipe
 * or an assembly can never quietly mix units.
 *
 * `UnitConversion` semantics: "1 fromUnit = conversionRatio toUnit".
 *   - same unit            -> identity
 *   - row from -> to       -> qty × ratio
 *   - row to -> from       -> qty ÷ ratio   (the inverse of the stored row)
 *
 * All arithmetic is `Prisma.Decimal` (decimal.js, 20 significant digits) —
 * never floats. Callers that need a whole number (stock quantities are
 * integers) check `result.isInteger()` themselves.
 */
@Injectable()
export class UnitConversionService {
  constructor(private readonly prisma: PrismaService) {}

  async convert(
    quantity: Prisma.Decimal | string | number,
    fromUnitId: string,
    toUnitId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Prisma.Decimal> {
    const value = new Prisma.Decimal(quantity);
    if (fromUnitId === toUnitId) return value;

    const rows = await tx.unitConversion.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { fromUnitId, toUnitId },
          { fromUnitId: toUnitId, toUnitId: fromUnitId },
        ],
      },
      select: { fromUnitId: true, toUnitId: true, conversionRatio: true },
    });
    const direct = rows.find(
      (row) => row.fromUnitId === fromUnitId && row.toUnitId === toUnitId,
    );
    if (direct && direct.conversionRatio.gt(0)) {
      return value.mul(direct.conversionRatio);
    }
    const inverse = rows.find(
      (row) => row.fromUnitId === toUnitId && row.toUnitId === fromUnitId,
    );
    if (inverse && inverse.conversionRatio.gt(0)) {
      return value.div(inverse.conversionRatio);
    }
    throw new UnprocessableEntityException({
      code: 'UNIT_CONVERSION_MISSING',
      message:
        'No active unit conversion exists between the two units — add one under Unit Conversions first.',
      fromUnitId,
      toUnitId,
    });
  }
}
