import {
  PaymentOrigin,
  PaymentSettlementStatus,
  PaymentStatus,
} from '@prisma/client';
import {
  collectionBreakdown,
  reverseBlockOf,
} from './store-order-money.service';

/**
 * R15 (D15-9) — the order "Collection" panel never shows a declaration or a
 * carrier's expected COD as money; verified cash is split by where it sits.
 */
describe('collectionBreakdown', () => {
  const claim = (
    status: PaymentStatus,
    origin: PaymentOrigin,
    amount: number,
    settlementStatus: PaymentSettlementStatus = PaymentSettlementStatus.NOT_APPLICABLE,
    settledAmount = 0,
  ) => ({ status, origin, amount, settlementStatus, settledAmount });

  it('declared and expected-from-carrier are claims; verified carrier / provider cash is split by settlement', () => {
    expect(
      collectionBreakdown([
        claim(PaymentStatus.PENDING, PaymentOrigin.SALES_DECLARATION, 50),
        claim(PaymentStatus.MATCHED, PaymentOrigin.SALES_DECLARATION, 25),
        claim(PaymentStatus.PENDING, PaymentOrigin.CARRIER_COD, 100),
        claim(
          PaymentStatus.VERIFIED,
          PaymentOrigin.CARRIER_COD,
          200,
          PaymentSettlementStatus.PARTIALLY_SETTLED,
          120,
        ),
        claim(
          PaymentStatus.VERIFIED,
          PaymentOrigin.SALES_DECLARATION,
          70,
          PaymentSettlementStatus.AWAITING_SETTLEMENT,
        ),
        claim(
          PaymentStatus.VERIFIED,
          PaymentOrigin.SALES_DECLARATION,
          30,
          PaymentSettlementStatus.SETTLED,
          30,
        ),
        claim(PaymentStatus.REJECTED, PaymentOrigin.SALES_DECLARATION, 999),
        claim(PaymentStatus.REVERSED, PaymentOrigin.SALES_DECLARATION, 999),
      ]),
    ).toEqual({
      declared: 75,
      expectedFromCarrier: 100,
      withCarrier: 80,
      awaitingSettlement: 70,
    });
  });
});

describe('reverseBlockOf', () => {
  const verified = {
    destinationOwnership: null,
    activeMatches: 0,
    settledAmount: 0,
    settlementStatus: PaymentSettlementStatus.NOT_APPLICABLE,
  };

  it('a Finance-verified claim without match or settlement can be reversed', () => {
    expect(reverseBlockOf(verified)).toBeNull();
  });

  it('a settled claim is blocked by its settlement before its match', () => {
    expect(
      reverseBlockOf({
        ...verified,
        activeMatches: 1,
        settledAmount: 10,
        settlementStatus: PaymentSettlementStatus.PARTIALLY_SETTLED,
      }),
    ).toBe('SETTLED');
    expect(reverseBlockOf({ ...verified, activeMatches: 1 })).toBe('MATCHED');
    expect(reverseBlockOf({ ...verified, destinationOwnership: 'AGENT' })).toBe(
      'AGENT_RECEIVED',
    );
  });
});
