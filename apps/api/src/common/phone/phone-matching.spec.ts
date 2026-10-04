import {
  PhoneNumberService,
  phoneSearchCandidates,
} from './phone-number.service';
import { classifyQuery } from '../../customer-lookup/customer-lookup.util';

/**
 * R11 — the ONE phone matching path: identity candidates (full valid E.164
 * only) and list-search candidates (digit fragments, Arabic digits included).
 */
describe('phone matching (R11)', () => {
  const phones = new PhoneNumberService();

  describe('lookupCandidates — identity, never a suffix', () => {
    it('reads every format of one Saudi number as the same E.164', () => {
      for (const input of [
        '+966501234567',
        '00966501234567',
        '966501234567',
        '0501234567',
        '501234567',
        '+966 50 123 4567',
        '٠٥٠١٢٣٤٥٦٧',
        '+٩٦٦٥٠١٢٣٤٥٦٧',
      ]) {
        expect(phones.lookupCandidates(input, 'SA')).toContain('+966501234567');
      }
    });

    it('finds the number under the market it was saved as when the typed country is wrong', () => {
      // Egyptian mobile in national form, Saudi Arabia selected.
      expect(phones.lookupCandidates('01063233211', 'SA')).toContain(
        '+201063233211',
      );
      // No country at all.
      expect(phones.lookupCandidates('01063233211')).toContain('+201063233211');
    });

    it('the chosen country is authoritative when the number is valid in it; otherwise every valid reading', () => {
      // 055… is a Saudi mobile AND an Egyptian landline.
      expect(phones.lookupCandidates('0550352030', 'EG')).toEqual([
        '+20550352030',
      ]);
      expect(phones.lookupCandidates('0550352030', 'SA')).toEqual([
        '+966550352030',
      ]);
      // No country chosen: every valid reading is tried.
      expect(phones.lookupCandidates('0550352030')).toEqual(
        expect.arrayContaining(['+20550352030', '+966550352030']),
      );
      // The Create/Update guard keeps the single narrowest reading.
      expect(phones.lookupCandidates('0550352030', null, true)).toHaveLength(1);
    });

    it('never matches by suffix or fragment', () => {
      expect(phones.lookupCandidates('1234567')).toEqual([]);
      expect(phones.lookupCandidates('')).toEqual([]);
      expect(phones.lookupCandidates('123456')).toEqual([]);
      expect(phones.lookupCandidates('+966501234568')).not.toContain(
        '+966501234567',
      );
    });
  });

  describe('phoneSearchCandidates — list search fragments', () => {
    it('strips a trunk 0 or 00 and reads Arabic digits', () => {
      expect(phoneSearchCandidates('0501234567')).toEqual(
        expect.arrayContaining(['0501234567', '501234567']),
      );
      expect(phoneSearchCandidates('00966501234567')).toEqual(
        expect.arrayContaining(['966501234567']),
      );
      expect(phoneSearchCandidates('٠٥٠١٢٣٤٥٦٧')).toEqual(
        expect.arrayContaining(['501234567']),
      );
    });

    it('is empty for text that is not a phone fragment', () => {
      expect(phoneSearchCandidates('ORD-12')).toEqual([]);
      expect(phoneSearchCandidates('12345')).toEqual([]);
      expect(phoneSearchCandidates(null)).toEqual([]);
    });
  });

  describe('advanced lookup query classification', () => {
    it('an Arabic-digit number is a phone, not a one-word name', () => {
      expect(classifyQuery('٠٥٠١٢٣٤٥٦٧')).toMatchObject({
        kind: 'PHONE',
        digits: '0501234567',
      });
      expect(classifyQuery('+٩٦٦ ٥٠ ١٢٣ ٤٥٦٧')).toMatchObject({
        kind: 'PHONE',
      });
      expect(classifyQuery('٠٥٠')).toMatchObject({ kind: 'INVALID' });
    });
  });
});
