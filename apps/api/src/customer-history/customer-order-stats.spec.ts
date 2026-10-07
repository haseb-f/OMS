import { SalesDocumentStatus } from '@prisma/client';
import {
  isCompletedSalesDocument,
  isCompletedStoreOrder,
  isPlacedSalesDocument,
  isPlacedStoreOrder,
  isRepeatCustomer,
  productSummary,
} from './customer-order-stats';

describe('R14 customer-order-stats definitions', () => {
  it('a store order is placed unless cancelled (no status yet = placed)', () => {
    for (const code of [
      'UNFULFILLED',
      'READY',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'FAILED',
      'RETURNED',
      'AWAITING_PREPARATION',
      'READY_FOR_PICKUP',
      'COLLECTED',
      null,
    ]) {
      expect(isPlacedStoreOrder(code)).toBe(true);
    }
    expect(isPlacedStoreOrder('CANCELLED')).toBe(false);
  });

  it('a completed purchase is DELIVERED or COLLECTED — never RETURNED', () => {
    expect(isCompletedStoreOrder('DELIVERED')).toBe(true);
    expect(isCompletedStoreOrder('COLLECTED')).toBe(true);
    for (const code of ['RETURNED', 'CANCELLED', 'SHIPPED', 'FAILED', null]) {
      expect(isCompletedStoreOrder(code)).toBe(false);
    }
  });

  it('B2B sales orders: DRAFT / CANCELLED are not placed; DELIVERED / CLOSED complete', () => {
    expect(isPlacedSalesDocument(SalesDocumentStatus.DRAFT)).toBe(false);
    expect(isPlacedSalesDocument(SalesDocumentStatus.CANCELLED)).toBe(false);
    expect(isPlacedSalesDocument(SalesDocumentStatus.CONFIRMED)).toBe(true);
    expect(isPlacedSalesDocument(SalesDocumentStatus.PENDING_APPROVAL)).toBe(
      true,
    );
    expect(isCompletedSalesDocument(SalesDocumentStatus.DELIVERED)).toBe(true);
    expect(isCompletedSalesDocument(SalesDocumentStatus.CLOSED)).toBe(true);
    expect(
      isCompletedSalesDocument(SalesDocumentStatus.PARTIALLY_DELIVERED),
    ).toBe(false);
  });

  it('repeat customer from two placed orders', () => {
    expect(isRepeatCustomer(0)).toBe(false);
    expect(isRepeatCustomer(1)).toBe(false);
    expect(isRepeatCustomer(2)).toBe(true);
  });

  it('product summary: first two names + "+N", duplicates once', () => {
    expect(productSummary([])).toBe('');
    expect(productSummary(['A'])).toBe('A');
    expect(productSummary(['A', 'A', 'B'])).toBe('A · B');
    expect(productSummary(['A', 'B', 'C', 'D'])).toBe('A · B +2');
  });
});
