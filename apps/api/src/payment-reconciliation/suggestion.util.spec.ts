import {
  rankSuggestions,
  scoreCandidate,
  type SuggestionCandidate,
  type SuggestionLine,
} from './suggestion.util';

const LINE: SuggestionLine = {
  providerReference: 'TBY-1',
  orderReference: 'SO-100',
  customerName: 'محمد أحمد',
  customerPhoneE164: '+966501234567',
  providerStatus: 'CAPTURED',
  remaining: 500,
  transactionDate: new Date('2026-09-20T00:00:00Z'),
  currencyCode: 'SAR',
};

function candidate(
  overrides: Partial<SuggestionCandidate>,
): SuggestionCandidate {
  return {
    paymentId: 'p',
    referenceNumber: null,
    orderNumbers: [],
    names: [],
    phonesE164: [],
    remaining: 500,
    paymentDate: new Date('2026-09-19T10:00:00Z'),
    ...overrides,
  };
}

describe('suggestion scoring', () => {
  it('exact order reference is strong and ranks first', () => {
    const ranked = rankSuggestions(LINE, [
      candidate({ paymentId: 'phone', phonesE164: ['+966501234567'] }),
      candidate({ paymentId: 'order', orderNumbers: ['#so-100'] }),
      candidate({ paymentId: 'name', names: ['محمد احمد'] }),
    ]);
    expect(ranked.candidates.map((c) => c.paymentId)).toEqual([
      'order',
      'phone',
      'name',
    ]);
    expect(ranked.candidates[0].strength).toBe('STRONG');
    expect(ranked.candidates[0].reasons.map((r) => r.signal)).toEqual(
      expect.arrayContaining(['ORDER', 'AMOUNT', 'DATE', 'CURRENCY', 'STATUS']),
    );
    expect(ranked.ambiguous).toBe(false);
  });

  it('payment reference equal to the provider reference is strong', () => {
    const scored = scoreCandidate(
      LINE,
      candidate({ referenceNumber: 'tby-1' }),
    );
    expect(scored.strength).toBe('STRONG');
    expect(scored.reasons[0].signal).toBe('REFERENCE');
  });

  it('name-only matches are never strong', () => {
    const scored = scoreCandidate(
      LINE,
      candidate({ names: ['مُحَمَّد أحمد'] }),
    );
    expect(scored.reasons.map((r) => r.signal)).toContain('NAME');
    expect(scored.strength).not.toBe('STRONG');
  });

  it('phone alone is medium; phone + amount + date is strong', () => {
    const phoneOnly = scoreCandidate(
      LINE,
      candidate({
        phonesE164: ['+966501234567'],
        remaining: 400,
        paymentDate: new Date('2026-08-01'),
      }),
    );
    expect(phoneOnly.strength).toBe('MEDIUM');
    expect(phoneOnly.suggestible).toBe(false); // amount differs, no reference
    const full = scoreCandidate(
      LINE,
      candidate({ phonesE164: ['+966501234567'] }),
    );
    expect(full.strength).toBe('STRONG');
  });

  it('amount mismatch is only suggestible with an exact reference (explicit partial allocation)', () => {
    expect(
      scoreCandidate(LINE, candidate({ names: ['محمد أحمد'], remaining: 900 }))
        .suggestible,
    ).toBe(false);
    const partial = scoreCandidate(
      LINE,
      candidate({ orderNumbers: ['SO-100'], remaining: 900 }),
    );
    expect(partial.suggestible).toBe(true);
    expect(partial.amountMatches).toBe(false);
    expect(partial.reasons.map((r) => r.signal)).toContain('AMOUNT_DIFFERS');
  });

  it('flags ambiguity when two candidates share the top score', () => {
    const ranked = rankSuggestions(LINE, [
      candidate({ paymentId: 'a', phonesE164: ['+966501234567'] }),
      candidate({ paymentId: 'b', phonesE164: ['+966501234567'] }),
      candidate({ paymentId: 'c', names: ['محمد أحمد'] }),
    ]);
    expect(ranked.ambiguous).toBe(true);
    expect(
      ranked.candidates
        .slice(0, 2)
        .map((c) => c.paymentId)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('failed / refunded provider transactions get no suggestions', () => {
    const ranked = rankSuggestions({ ...LINE, providerStatus: 'Refunded' }, [
      candidate({ orderNumbers: ['SO-100'] }),
    ]);
    expect(ranked.candidates).toEqual([]);
  });

  it('marks an unknown provider status as unverified', () => {
    const scored = scoreCandidate(
      { ...LINE, providerStatus: 'processing' },
      candidate({ orderNumbers: ['SO-100'] }),
    );
    expect(scored.reasons.map((r) => r.signal)).toContain('STATUS_UNVERIFIED');
  });
});
