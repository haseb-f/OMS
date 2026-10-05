import { ItemType, ProductStatus, ProductType } from '@prisma/client';

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

/** Why a Product can never be offered to Investment Opportunities (R13, API-enforced — not only a UI filter). */
export type InvestmentBlockedReason =
  'AGENT_OWNED' | 'SERVICE' | 'NOT_SELLABLE' | 'NOT_ACTIVE';

export interface InvestmentStructuralCandidate {
  status: ProductStatus;
  deletedAt: Date | null;
  ownerAgentId: string | null;
  itemType: ItemType | null;
  type: ProductType;
  isSellable: boolean;
}

/**
 * The structural half of eligibility (spec §7): only company-owned, sellable,
 * ACTIVE, non-service goods may be offered to investors — independent of the
 * explicit opt-in flag, which `isInvestmentEligible` still checks. Returns the
 * first reason in a fixed order, or null when nothing structural blocks it.
 */
export function investmentBlockedReason(
  product: InvestmentStructuralCandidate,
): InvestmentBlockedReason | null {
  if (product.ownerAgentId) return 'AGENT_OWNED';
  if (
    product.itemType === ItemType.SERVICE ||
    (product.itemType === null && product.type === ProductType.SERVICE)
  ) {
    return 'SERVICE';
  }
  if (!product.isSellable) return 'NOT_SELLABLE';
  if (product.deletedAt !== null || product.status !== ProductStatus.ACTIVE) {
    return 'NOT_ACTIVE';
  }
  return null;
}

const BLOCKED_REASON_TEXT: Record<InvestmentBlockedReason, string> = {
  AGENT_OWNED: 'منتج مملوك لوكيل — Agent-owned goods',
  SERVICE: 'خدمة — A service',
  NOT_SELLABLE: 'غير قابل للبيع — Not sellable',
  NOT_ACTIVE: 'غير نشط أو مؤرشف — Not active or archived',
};

/** 422 body shared by the Opportunity product guard and the Product flag guard. */
export function investmentNotAllowedBody(
  reason: InvestmentBlockedReason,
  displayName: string,
) {
  return {
    code: 'PRODUCT_INVESTMENT_NOT_ALLOWED',
    reason,
    message: `لا يمكن عرض المنتج "${displayName}" على فرص الاستثمار (${BLOCKED_REASON_TEXT[reason]}) — Product "${displayName}" cannot be offered to Investment Opportunities.`,
  };
}
