import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type ProductReader = Pick<Prisma.TransactionClient, 'product'>;

/** 422 body shared by every company-document path (S2 / F-H1). */
export function agentProductInCompanyDocument(productId: string) {
  return new UnprocessableEntityException({
    code: 'AGENT_PRODUCT_IN_COMPANY_DOCUMENT',
    message: `هذا المنتج مملوك لوكيل ويُباع فقط من خلال طلب وكيل — Product ${productId} is owned by an agent: it is sold only through an agent order and cannot appear on company leads, sales or purchase documents.`,
  });
}

/**
 * Agents milestone (spec §4, S2): agent-owned goods are never company
 * merchandise. Every company document / lead line path — lead create /
 * update / import, lead → order conversion, store orders, sales quotations /
 * orders / invoices / returns and purchase documents (the company never buys
 * an agent's own goods) — rejects them. Sync form for callers that already
 * hold the product row (e.g. `ProductsService.findManyForValidation`).
 */
export function assertCompanyOwnedProduct(product: {
  id: string;
  ownerAgentId?: string | null;
}) {
  if (product.ownerAgentId) throw agentProductInCompanyDocument(product.id);
}

/** Query form: one batched lookup; unknown ids are left to the caller's own existence check. */
export async function assertCompanyOwnedProducts(
  productIds: Array<string | null | undefined>,
  db: ProductReader,
) {
  const ids = [...new Set(productIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  const owned = await db.product.findFirst({
    where: { id: { in: ids }, ownerAgentId: { not: null } },
    select: { id: true },
  });
  if (owned) throw agentProductInCompanyDocument(owned.id);
}
