import { FinancialTransactionStatus } from '@prisma/client';
import {
  matchReversalEffect,
  receiptPredatesMatching,
} from './match-reversal.util';
import {
  BulkItemError,
  bulkFailure,
  runPerItem,
} from '../common/bulk/bulk-item-result';
import { ConflictException } from '@nestjs/common';

const matchedAt = new Date('2026-09-20T10:00:00Z');
const receipt = (
  createdAt: string,
  status = FinancialTransactionStatus.CONFIRMED,
) => ({
  createdAt: new Date(createdAt),
  status,
});

describe('matchReversalEffect', () => {
  it('names a posting created by reconciliation as REVERSE_POSTING', () => {
    expect(
      matchReversalEffect(receipt('2026-09-20T10:00:01Z'), matchedAt),
    ).toBe('REVERSE_POSTING');
  });

  it('is only an UNMATCH without a receipt, for a cancelled receipt, or for a receipt posted before matching', () => {
    expect(matchReversalEffect(null, matchedAt)).toBe('UNMATCH');
    expect(
      matchReversalEffect(
        receipt('2026-09-21T00:00:00Z', FinancialTransactionStatus.CANCELLED),
        matchedAt,
      ),
    ).toBe('UNMATCH');
    expect(
      matchReversalEffect(receipt('2026-09-19T00:00:00Z'), matchedAt),
    ).toBe('UNMATCH');
    expect(
      receiptPredatesMatching(receipt('2026-09-19T00:00:00Z'), matchedAt),
    ).toBe(true);
  });
});

describe('runPerItem', () => {
  it('de-duplicates ids, keeps going after a failure and maps error codes', async () => {
    const seen: string[] = [];
    const result = await runPerItem(['a', 'b', 'a', 'c'], (id) => {
      seen.push(id);
      if (id === 'b') return Promise.reject(new ConflictException('locked'));
      if (id === 'c')
        return Promise.reject(new BulkItemError('ALREADY_POSTED', 'posted'));
      return Promise.resolve(id);
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(result.succeeded).toEqual(['a']);
    expect(result.failed).toEqual([
      { id: 'b', code: 'CONFLICT', message: 'locked' },
      { id: 'c', code: 'ALREADY_POSTED', message: 'posted' },
    ]);
  });

  it('never leaks unexpected error details', () => {
    const failure = bulkFailure(
      'x',
      new Error('relation "payments" does not exist'),
    );
    expect(failure.code).toBe('INTERNAL_ERROR');
    expect(failure.message).not.toMatch(/relation/);
  });
});
