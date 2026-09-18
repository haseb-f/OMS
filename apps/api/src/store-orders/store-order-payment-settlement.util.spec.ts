import { BadRequestException } from '@nestjs/common';
import { StoreOrderPaymentStatus } from '@prisma/client';
import {
  assertCanAcceptPayment,
  assertCanVerifyPayment,
  settlementFromTotals,
} from './store-order-payment-settlement.util';

describe('store-order-payment-settlement', () => {
  const base = {
    paymentStatus: StoreOrderPaymentStatus.PARTIALLY_PAID,
  };

  it('computes outstanding, claimed remaining, and fullySettled from verified vs claimed', () => {
    const settlement = settlementFromTotals({
      total: 100,
      paid: 40,
      claimed: 70,
      ...base,
    });
    expect(settlement.outstanding).toBe(60);
    expect(settlement.remainingToClaim).toBe(30);
    expect(settlement.fullySettled).toBe(false);
    expect(settlement.canAcceptPayment).toBe(true);
  });

  it('marks a fully verified document as settled and blocks further payments', () => {
    const settlement = settlementFromTotals({
      total: 100,
      paid: 100,
      claimed: 100,
      paymentStatus: StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
    });
    expect(settlement.fullySettled).toBe(true);
    expect(settlement.canAcceptPayment).toBe(false);
    expect(() => assertCanAcceptPayment(settlement, 1)).toThrow(
      BadRequestException,
    );
  });

  it('caps a new claim at the unclaimed remainder', () => {
    const settlement = settlementFromTotals({
      total: 100,
      paid: 40,
      claimed: 90,
      ...base,
    });
    expect(() => assertCanAcceptPayment(settlement, 20)).toThrow(
      /exceeds remaining/,
    );
    expect(() => assertCanAcceptPayment(settlement, 10)).not.toThrow();
  });

  it('blocks verifying an amount that would overpay the document', () => {
    const settlement = settlementFromTotals({
      total: 100,
      paid: 90,
      claimed: 90,
      ...base,
    });
    expect(() => assertCanVerifyPayment(settlement, 20)).toThrow(/overpay/);
    expect(() => assertCanVerifyPayment(settlement, 10)).not.toThrow();
  });
});
