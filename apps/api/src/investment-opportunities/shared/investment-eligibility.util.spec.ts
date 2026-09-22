import { ProductStatus } from '@prisma/client';
import {
  investmentIneligibleMessage,
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
