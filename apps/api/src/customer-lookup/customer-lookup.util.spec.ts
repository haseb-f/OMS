import {
  classifyQuery,
  leadStatusBucket,
  maskName,
  maskPhone,
  orderStatusBucket,
} from './customer-lookup.util';

describe('customer lookup helpers', () => {
  describe('classifyQuery', () => {
    it('accepts a phone with at least 7 digits (any common punctuation)', () => {
      expect(classifyQuery('0501234567')).toMatchObject({ kind: 'PHONE' });
      expect(classifyQuery('+966 50 123 4567')).toMatchObject({
        kind: 'PHONE',
        digits: '966501234567',
      });
      expect(classifyQuery('(050) 123-4567')).toMatchObject({ kind: 'PHONE' });
    });

    it('rejects a phone with fewer than 7 digits', () => {
      expect(classifyQuery('123456')).toEqual({
        kind: 'INVALID',
        reason: 'TOO_SHORT',
      });
    });

    it('accepts only a first-and-last name (Arabic included), never a bare prefix', () => {
      expect(classifyQuery('Ahmed Salem')).toMatchObject({
        kind: 'NAME',
        words: ['Ahmed', 'Salem'],
      });
      expect(classifyQuery('أحمد سالم')).toMatchObject({ kind: 'NAME' });
      // A single word, however long, is a sweepable prefix — refused.
      expect(classifyQuery('Ahmed')).toMatchObject({ kind: 'INVALID' });
      expect(classifyQuery('أحمد')).toMatchObject({ kind: 'INVALID' });
      // Each word needs two letters and the whole name six.
      expect(classifyQuery('A Salem')).toMatchObject({ kind: 'INVALID' });
      expect(classifyQuery('Al Ro')).toMatchObject({ kind: 'INVALID' });
    });

    it('rejects empty and over-long input', () => {
      expect(classifyQuery('   ')).toMatchObject({ kind: 'INVALID' });
      expect(classifyQuery(undefined)).toMatchObject({ kind: 'INVALID' });
      expect(classifyQuery('a'.repeat(61))).toEqual({
        kind: 'INVALID',
        reason: 'TOO_LONG',
      });
    });
  });

  describe('masking', () => {
    it('keeps only the calling-code head and the last three digits of a phone', () => {
      expect(maskPhone('+966501234567')).toBe('+966••••••567');
      expect(maskPhone('+201001234567')).toBe('+201••••••567');
      expect(maskPhone('')).toBeNull();
      expect(maskPhone(null)).toBeNull();
    });

    it('never reveals more than two letters of any name word', () => {
      expect(maskName('Ahmed Salem Ali')).toBe('Ah••• Sa••• Al•••');
      expect(maskName('أحمد سالم')).toBe('أح••• سا•••');
      expect(maskName('X')).toBe('•••');
      expect(maskName('')).toBe('');
    });
  });

  describe('coarse statuses', () => {
    it('buckets fulfillment and lead codes without exposing the raw status', () => {
      expect(orderStatusBucket('DELIVERED')).toBe('COMPLETED');
      expect(orderStatusBucket('COLLECTED')).toBe('COMPLETED');
      expect(orderStatusBucket('CANCELLED')).toBe('CANCELLED');
      expect(orderStatusBucket('RETURNED')).toBe('RETURNED');
      expect(orderStatusBucket('PROCESSING')).toBe('IN_PROGRESS');
      expect(orderStatusBucket(null)).toBe('IN_PROGRESS');
      expect(leadStatusBucket('CONVERTED')).toBe('CONVERTED');
      expect(leadStatusBucket('LOST')).toBe('CLOSED');
      expect(leadStatusBucket('NEW')).toBe('OPEN');
    });
  });
});
