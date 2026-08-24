import { PhoneNumberService } from './phone-number.service';

/**
 * Every fixture below was verified directly against the installed
 * `libphonenumber-js` metadata (see `pnpm --filter api run phone:audit`'s
 * sibling exploration in the implementation notes) — never invented. Real
 * example numbers come from the library's own `examples.mobile.json`.
 */
const EXAMPLES: Record<
  string,
  { region: string; callingCode: string; national: string }
> = {
  'Saudi Arabia': { region: 'SA', callingCode: '966', national: '512345678' },
  Egypt: { region: 'EG', callingCode: '20', national: '1001234567' },
  UAE: { region: 'AE', callingCode: '971', national: '501234567' },
  Kuwait: { region: 'KW', callingCode: '965', national: '50012345' },
  Qatar: { region: 'QA', callingCode: '974', national: '33123456' },
  Bahrain: { region: 'BH', callingCode: '973', national: '36001234' },
  Oman: { region: 'OM', callingCode: '968', national: '92123456' },
  Jordan: { region: 'JO', callingCode: '962', national: '790123456' },
  Morocco: { region: 'MA', callingCode: '212', national: '650123456' },
  Tunisia: { region: 'TN', callingCode: '216', national: '20123456' },
  Algeria: { region: 'DZ', callingCode: '213', national: '551234567' },
  Yemen: { region: 'YE', callingCode: '967', national: '712345678' },
  Turkey: { region: 'TR', callingCode: '90', national: '5012345678' },
  'United States': { region: 'US', callingCode: '1', national: '2015550123' },
  'United Kingdom': { region: 'GB', callingCode: '44', national: '7400123456' },
  Germany: { region: 'DE', callingCode: '49', national: '15123456789' },
  France: { region: 'FR', callingCode: '33', national: '612345678' },
};

describe('PhoneNumberService', () => {
  const service = new PhoneNumberService();

  describe.each(Object.entries(EXAMPLES))(
    '%s',
    (_countryName, { region, callingCode, national }) => {
      const e164 = `+${callingCode}${national}`;

      it('accepts the library-provided example in local format', () => {
        const result = service.parse(national, region);
        expect(result.isValid).toBe(true);
        expect(result.e164).toBe(e164);
        expect(result.callingCode).toBe(callingCode);
      });

      it('accepts the same number in full international "+" format', () => {
        const result = service.parse(e164, region);
        expect(result.isValid).toBe(true);
        expect(result.e164).toBe(e164);
      });

      it("accepts the same number via its region's real international exit code", () => {
        // NANP (US/Canada/...) dials out via "011", not "00" — a real
        // regional difference the library models correctly; asserting "00"
        // universally would itself be the kind of invented, not-actually-
        // metadata-driven rule this service is built to avoid.
        const exitCode = region === 'US' ? '011' : '00';
        const result = service.parse(
          `${exitCode}${callingCode}${national}`,
          region,
        );
        expect(result.isValid).toBe(true);
        expect(result.e164).toBe(e164);
      });

      it('never double-prepends the calling code for an already-international number', () => {
        const result = service.parse(e164, region);
        expect(result.e164).not.toContain(`+${callingCode}${callingCode}`);
        expect(result.e164).toBe(e164);
      });

      it('rejects a clearly-incomplete single-digit input', () => {
        // Not "one digit short of the example" — several of these
        // countries' real numbering plans (Egypt, Germany, ...) accept more
        // than one valid national length, so trimming an arbitrary example
        // by one digit isn't reliably invalid. A single digit always is.
        const result = service.parse('1', region);
        expect(result.isValid).toBe(false);
      });

      it('rejects a number with far too many digits', () => {
        const result = service.parse(`${national}999999999`, region);
        expect(result.isValid).toBe(false);
        expect(result.errorReason).toBe('TOO_LONG');
      });

      it('rejects non-numeric garbage', () => {
        const result = service.parse('a'.repeat(national.length), region);
        expect(result.isValid).toBe(false);
        expect(result.errorReason).toBe('NOT_A_NUMBER');
      });

      it('produces a real example number for the region', () => {
        expect(service.getExampleNumber(region)).toBe(national);
        expect(service.getCallingCode(region)).toBe(callingCode);
      });
    },
  );

  describe('local-format leading-zero handling (Saudi Arabia)', () => {
    it('normalizes "0501234567" (leading trunk zero) to the same E.164 as "501234567"', () => {
      const withZero = service.parse('0501234567', 'SA');
      const withoutZero = service.parse('501234567', 'SA');
      expect(withZero.isValid).toBe(true);
      expect(withZero.e164).toBe(withoutZero.e164);
      expect(withZero.e164).toBe('+966501234567');
    });

    it('still rejects a genuinely short Saudi number after normalization', () => {
      const result = service.parse('050123', 'SA');
      expect(result.isValid).toBe(false);
      expect(result.e164).toBeNull();
    });
  });

  describe('cross-region detection (Part 19 — "+" always wins)', () => {
    it('detects Egypt from a "+20..." number even while Saudi Arabia is the selected region', () => {
      const result = service.parse('+201001234567', 'SA');
      expect(result.isValid).toBe(true);
      expect(result.detectedRegion).toBe('EG');
      expect(result.regionMismatch).toBe(true);
    });

    it('does not flag a mismatch when the number matches the selected region', () => {
      const result = service.parse('+966501234567', 'SA');
      expect(result.regionMismatch).toBe(false);
    });
  });

  describe('duplicate-detection equivalence (Part 10)', () => {
    it('normalizes every common representation of the same Saudi number to one canonical E.164', () => {
      const variants = [
        '+966501234567',
        '00966501234567',
        '0501234567',
        '501234567',
        '966501234567',
        '050 123 4567',
        '050-123-4567',
      ];
      const normalized = new Set(
        variants.map((v) => service.normalizeToE164(v, 'SA')),
      );
      expect(normalized.size).toBe(1);
      expect([...normalized][0]).toBe('+966501234567');
    });
  });

  describe('empty / missing input', () => {
    it('treats an empty string as EMPTY, never a crash', () => {
      const result = service.parse('', 'SA');
      expect(result.isValid).toBe(false);
      expect(result.errorReason).toBe('EMPTY');
      expect(result.e164).toBeNull();
    });

    it('treats undefined/null as EMPTY', () => {
      expect(service.parse(undefined, 'SA').errorReason).toBe('EMPTY');
      expect(service.parse(null, 'SA').errorReason).toBe('EMPTY');
    });
  });

  describe('no country context (User.mobile — no sibling Country field)', () => {
    it('accepts a full international number with no default region', () => {
      const result = service.parse('+966501234567');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+966501234567');
    });

    it('cannot validate a bare local-format number with no region to parse it against', () => {
      const result = service.parse('0501234567');
      expect(result.isValid).toBe(false);
    });
  });

  describe('isSupportedRegion / unsupported country code', () => {
    it('returns false for a code that is not a real ISO 3166-1 alpha-2 region', () => {
      expect(service.isSupportedRegion('XX')).toBe(false);
      expect(service.isSupportedRegion(null)).toBe(false);
      expect(service.isSupportedRegion(undefined)).toBe(false);
    });

    it('falls back gracefully when parse() is given an unsupported region', () => {
      const result = service.parse('501234567', 'XX');
      expect(result.isValid).toBe(false);
    });
  });

  describe('isValidForRegion convenience method', () => {
    it('mirrors parse().isValid', () => {
      expect(service.isValidForRegion('501234567', 'SA')).toBe(true);
      expect(service.isValidForRegion('12345', 'SA')).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // Canonical Phone Normalization — the exact examples from the "Phone
  // Normalization + Batch-Wide Phone Duplicate Review" spec.
  // -------------------------------------------------------------------
  describe('required normalization examples', () => {
    it('Saudi Arabia — with leading zero: 0578909876 -> +966578909876', () => {
      const result = service.parse('0578909876', 'SA');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+966578909876');
    });

    it('Saudi Arabia — without leading zero: 578909876 -> +966578909876', () => {
      const result = service.parse('578909876', 'SA');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+966578909876');
    });

    it('Saudi Arabia — 00 international prefix: 00966578909876 -> +966578909876', () => {
      const result = service.parse('00966578909876', 'SA');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+966578909876');
    });

    it('Egypt — with leading zero: 01087899877 -> +201087899877', () => {
      const result = service.parse('01087899877', 'EG');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+201087899877');
    });

    it('Egypt — without leading zero: 1087899877 -> +201087899877', () => {
      const result = service.parse('1087899877', 'EG');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+201087899877');
    });

    it('accepts Arabic-Indic digits and normalizes them like Western digits', () => {
      // ٠٥٧٨٩٠٩٨٧٦ == 0578909876
      const result = service.parse('٠٥٧٨٩٠٩٨٧٦', 'SA');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+966578909876');
    });

    it('accepts a valid explicit E.164 input unchanged', () => {
      const result = service.parse('+966578909876', 'SA');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe('+966578909876');
    });

    it('rejects a truly incomplete number and never invents missing digits', () => {
      const result = service.parse('5789', 'SA');
      expect(result.isValid).toBe(false);
      expect(result.e164).toBeNull();
      expect(result.errorReason).toBe('TOO_SHORT');
    });

    it('two same-phone spreadsheet rows normalize to the identical E.164 value for duplicate detection', () => {
      const a = service.normalizeToE164('0578909876', 'SA');
      const b = service.normalizeToE164('578909876', 'SA');
      expect(a).toBe(b);
      expect(a).toBe('+966578909876');
    });
  });

  // -------------------------------------------------------------------
  // Bare Country Calling Code Must Normalize Automatically — the exact
  // examples from the ticket, for Saudi Arabia (country: السعودية / SA).
  // -------------------------------------------------------------------
  describe('bare country calling code (Saudi Arabia)', () => {
    it.each([
      ['966564345678', '+966564345678'],
      ['+966564345678', '+966564345678'],
      ['00966564345678', '+966564345678'],
      ['0564345678', '+966564345678'],
      ['564345678', '+966564345678'],
    ])('%s -> %s', (raw, expected) => {
      const result = service.parse(raw, 'SA');
      expect(result.isValid).toBe(true);
      expect(result.e164).toBe(expected);
    });

    it('"966" alone is only a country calling code, not a complete number — stays invalid', () => {
      const result = service.parse('966', 'SA');
      expect(result.isValid).toBe(false);
      expect(result.e164).toBeNull();
      expect(result.callingCode).toBe('966');
    });

    it('never invents subscriber digits for a genuinely incomplete number', () => {
      const result = service.parse('9665643', 'SA');
      expect(result.isValid).toBe(false);
      expect(result.e164).toBeNull();
    });
  });
});
