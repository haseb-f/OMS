import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedTax {
  rate: number;
  inclusive: boolean;
}

type TaxReader = PrismaService | Prisma.TransactionClient;

export interface LineTaxInput {
  productId: string;
  taxId?: string | null;
}

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

/**
 * When a document line omits `taxId`, inherit `Product.taxId`.
 * Explicit line tax still wins. Products with no tax stay untaxed.
 * Dangling inherited taxIds fail closed via `resolveTaxesById`.
 */
export async function resolveLineTaxes(
  prisma: TaxReader,
  items: LineTaxInput[],
): Promise<{
  taxIds: Array<string | null>;
  taxById: Map<string, ResolvedTax>;
}> {
  const missingProductIds = [
    ...new Set(
      items.filter((item) => !item.taxId).map((item) => item.productId),
    ),
  ];
  const productTaxById = new Map<string, string | null>();
  if (missingProductIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: missingProductIds } },
      select: { id: true, taxId: true },
    });
    for (const product of products) {
      productTaxById.set(product.id, product.taxId);
    }
  }
  const taxIds = items.map(
    (item) => item.taxId ?? productTaxById.get(item.productId) ?? null,
  );
  const taxById = await resolveTaxesById(prisma, taxIds);
  return { taxIds, taxById };
}

export function assertPostedTaxAmountsHaveTax(
  items: Array<{ tax: { id: string } | null; taxAmount: unknown }>,
  context: string,
): void {
  for (const item of items) {
    if (Number(item.taxAmount) !== 0 && !item.tax) {
      throw new BadRequestException(
        `${context} has a tax amount without a resolvable tax. Missing tax cannot be treated as zero.`,
      );
    }
  }
}
