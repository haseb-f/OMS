import { ProductStatus } from '@prisma/client';

export interface InvestmentEligibilityCandidate {
  status: ProductStatus;
  deletedAt: Date | null;
  availableForInvestmentOpportunities: boolean;
}

/**
 * Investment eligibility rule (Investor Engine Part B #13/#66) — the ONE
 * definition shared by the Opportunity create/update guard and mirrored by
 * the Product catalog's `investmentEligible` filter (the web selector):
 * a Product can be NEWLY selected for an Investment Opportunity only while it
 * is ACTIVE, not archived and `availableForInvestmentOpportunities = true`.
 *
 * Losing eligibility later never rewrites history: Opportunities that already
 * reference the Product keep it (see `computeProductRows`' grandfathering of
 * `existingProductIds`), but it can no longer be added to any Opportunity.
 */
export function isInvestmentEligible(
  product: InvestmentEligibilityCandidate,
): boolean {
  return (
    product.deletedAt === null &&
    product.status === ProductStatus.ACTIVE &&
    product.availableForInvestmentOpportunities
  );
}

/** Clear, user-facing reason for a rejected (ineligible) Product selection. */
export function investmentIneligibleMessage(product: {
  displayName: string;
}): string {
  return `المنتج "${product.displayName}" غير متاح لفرص الاستثمار — يجب أن يكون المنتج نشطًا وغير مؤرشف ومفعّلًا عليه خيار «متاح لفرص الاستثمار».`;
}
