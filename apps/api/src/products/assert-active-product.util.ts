import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';

/**
 * Shared per-line "product exists and is ACTIVE" guard, given a pre-fetched
 * id -> product map (see `ProductsService.findManyForValidation`). Every
 * document-creation service (Sales/Purchase Orders, Invoices, Quotations,
 * Returns) previously reimplemented this exact check with its own
 * `findOne()` call per line item — same error type/message here, just
 * driven by one batched query instead of N sequential ones.
 */
export function assertActiveProduct(
  productId: string,
  productsById: Map<string, { id: string; status: ProductStatus }>,
): { id: string; status: ProductStatus } {
  const product = productsById.get(productId);
  if (!product) {
    throw new NotFoundException(`Product ${productId} not found`);
  }
  if (product.status !== ProductStatus.ACTIVE) {
    throw new BadRequestException('Product is inactive.');
  }
  return product;
}
