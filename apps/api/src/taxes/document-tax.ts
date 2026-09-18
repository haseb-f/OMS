import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedTax {
  rate: number;
  inclusive: boolean;
}

type TaxReader = PrismaService | Prisma.TransactionClient;

/**
 * Loads taxes by id and refuses to treat a missing tax as zero.
 * VAT0 is an explicit zero-rated tax (found, rate 0). A dangling taxId is an error.
 */
export async function resolveTaxesById(
  prisma: TaxReader,
  taxIds: Array<string | null | undefined>,
): Promise<Map<string, ResolvedTax>> {
  const ids = [...new Set(taxIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();

  const taxes = await prisma.tax.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, code: true, rate: true, inclusive: true },
  });
  const found = new Set(taxes.map((tax) => tax.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Tax ${missing.join(', ')} was not found. A missing tax cannot be treated as zero — select a valid tax, or VAT0 for a zero-rated line.`,
    );
  }
  return new Map(
    taxes.map((tax) => [
      tax.id,
      { rate: Number(tax.rate), inclusive: tax.inclusive },
    ]),
  );
}
