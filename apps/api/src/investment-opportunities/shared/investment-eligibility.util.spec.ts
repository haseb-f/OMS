import { ItemType, ProductStatus, ProductType } from '@prisma/client';
import {
  investmentBlockedReason,
  investmentIneligibleMessage,
  investmentNotAllowedBody,
  isInvestmentEligible,
} from './investment-eligibility.util';

describe('isInvestmentEligible', () => {
  const eligible = {
    status: ProductStatus.ACTIVE,
    deletedAt: null,
    availableForInvestmentOpportunities: true,
  };

  it('accepts an ACTIVE, non-archived, opted-in Product', () => {
    expect(isInvestmentEligible(eligible)).toBe(true);
  });

  it('rejects a Product not opted in', () => {
    expect(
      isInvestmentEligible({
        ...eligible,
        availableForInvestmentOpportunities: false,
      }),
    ).toBe(false);
  });

  it('rejects a DRAFT/INACTIVE Product even when opted in', () => {
    expect(
      isInvestmentEligible({ ...eligible, status: ProductStatus.DRAFT }),
    ).toBe(false);
    expect(
      isInvestmentEligible({ ...eligible, status: ProductStatus.INACTIVE }),
    ).toBe(false);
  });

  it('rejects an archived Product even when opted in', () => {
    expect(isInvestmentEligible({ ...eligible, deletedAt: new Date() })).toBe(
      false,
    );
  });

  it('names the Product in the rejection message', () => {
    expect(investmentIneligibleMessage({ displayName: 'Widget' })).toContain(
      '"Widget"',
    );
  });
});

describe('investmentBlockedReason', () => {
  const eligible = {
    status: ProductStatus.ACTIVE,
    deletedAt: null,
    ownerAgentId: null,
    itemType: ItemType.PRODUCT,
    type: ProductType.PURCHASE_AND_SALE,
    isSellable: true,
  };

  it('is null for a company-owned, sellable, ACTIVE PRODUCT', () => {
    expect(investmentBlockedReason(eligible)).toBeNull();
  });

  it('AGENT_OWNED wins over every other reason', () => {
    expect(
      investmentBlockedReason({
        ...eligible,
        ownerAgentId: 'agent-1',
        itemType: ItemType.SERVICE,
        isSellable: false,
        status: ProductStatus.INACTIVE,
      }),
    ).toBe('AGENT_OWNED');
  });

  it('SERVICE — by item type, or by the legacy type while unclassified', () => {
    expect(
      investmentBlockedReason({ ...eligible, itemType: ItemType.SERVICE }),
    ).toBe('SERVICE');
    expect(
      investmentBlockedReason({
        ...eligible,
        itemType: null,
        type: ProductType.SERVICE,
      }),
    ).toBe('SERVICE');
    expect(investmentBlockedReason({ ...eligible, itemType: null })).toBeNull();
  });

  it('NOT_SELLABLE', () => {
    expect(investmentBlockedReason({ ...eligible, isSellable: false })).toBe(
      'NOT_SELLABLE',
    );
  });

  it('NOT_ACTIVE for DRAFT / INACTIVE / archived', () => {
    for (const status of [ProductStatus.DRAFT, ProductStatus.INACTIVE]) {
      expect(investmentBlockedReason({ ...eligible, status })).toBe(
        'NOT_ACTIVE',
      );
    }
    expect(
      investmentBlockedReason({ ...eligible, deletedAt: new Date() }),
    ).toBe('NOT_ACTIVE');
  });

  it('builds the 422 body with the code, the reason and the product name', () => {
    const body = investmentNotAllowedBody('AGENT_OWNED', 'Widget');
    expect(body).toMatchObject({
      code: 'PRODUCT_INVESTMENT_NOT_ALLOWED',
      reason: 'AGENT_OWNED',
    });
    expect(body.message).toContain('"Widget"');
  });
});
