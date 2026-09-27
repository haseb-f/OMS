import { Prisma } from '@prisma/client';
import { FxProviderError, type FxQuote } from './fx-provider.types';

/**
 * Strict parser for the Central Bank of Egypt "Official Exchange Rates"
 * pages (see specs/payment-declaration-reconciliation/fx-source-research.md
 * §3.2–3.8). Any deviation from the observed schema rejects the WHOLE
 * payload — a half-understood page must never produce rates.
 *
 * No DOM library is used on purpose: the table is tiny and the checks below
 * (exactly one `table-comp`, exact headers, closed label dictionary,
 * decimal format, sanity bounds) are what actually protect the ledger.
 */

/** Closed dictionary: CBE English label → ISO code + quotation unit. */
export const CBE_LABELS: Readonly<
  Record<string, { code: string; unitDivisor: number }>
> = {
  'us dollar': { code: 'USD', unitDivisor: 1 },
  euro: { code: 'EUR', unitDivisor: 1 },
  'pound sterling': { code: 'GBP', unitDivisor: 1 },
  'canadian dollar': { code: 'CAD', unitDivisor: 1 },
  'danish krone': { code: 'DKK', unitDivisor: 1 },
  'norwegian krone': { code: 'NOK', unitDivisor: 1 },
  'swedish krona': { code: 'SEK', unitDivisor: 1 },
  'swiss franc': { code: 'CHF', unitDivisor: 1 },
  'japanese yen 100': { code: 'JPY', unitDivisor: 100 },
  'saudi riyal': { code: 'SAR', unitDivisor: 1 },
  'kuwaiti dinar': { code: 'KWD', unitDivisor: 1 },
  'uae dirham': { code: 'AED', unitDivisor: 1 },
  'australian dollar': { code: 'AUD', unitDivisor: 1 },
  'bahraini dinar': { code: 'BHD', unitDivisor: 1 },
  'omani riyal': { code: 'OMR', unitDivisor: 1 },
  'qatari riyal': { code: 'QAR', unitDivisor: 1 },
  'jordanian dinar': { code: 'JOD', unitDivisor: 1 },
  'chinese yuan': { code: 'CNY', unitDivisor: 1 },
};

/** English labels in the order CBE lists them (historical form options). */
export const CBE_ENGLISH_LABELS = [
  'US Dollar',
  'Euro',
  'Pound Sterling',
  'Canadian Dollar',
  'Danish Krone',
  'Norwegian Krone',
  'Swedish Krona',
  'Swiss Franc',
  'Japanese Yen 100',
  'Saudi Riyal',
  'Kuwaiti Dinar',
  'UAE Dirham',
  'Australian Dollar',
  'Bahraini Dinar',
  'Omani Riyal',
  'Qatari Riyal',
  'Jordanian Dinar',
  'Chinese Yuan',
] as const;

/** A latest-page payload missing any of these is rejected (research §3.8). */
export const CBE_REQUIRED_CODES = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD'];

const DECIMAL_RE = /^\d+\.\d{1,6}$/;
/** Max (sell − buy) / mid accepted as a sane official quote. */
const MAX_SPREAD = new Prisma.Decimal('0.02');

export interface CbeParsed {
  effectiveDates: string[];
  quotes: FxQuote[];
  warnings: string[];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function fail(message: string): never {
  throw new FxProviderError(`CBE payload rejected: ${message}`, 'PARSE');
}

/** 'dd/MM/yyyy' → 'YYYY-MM-DD' (strict; rejects impossible days). */
export function parseCbeDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) fail(`invalid date "${value}" (expected dd/MM/yyyy)`);
  const [, dd, mm, yyyy] = match;
  const iso = `${yyyy}-${mm}-${dd}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    fail(`impossible date "${value}"`);
  }
  return iso;
}

/** The single `table.table-comp` → { headers, rows (cell texts) }. */
function extractTable(html: string): { headers: string[]; rows: string[][] } {
  const tables = [
    ...html.matchAll(
      /<table\b[^>]*class="[^"]*\btable-comp\b[^"]*"[^>]*>([\s\S]*?)<\/table>/gi,
    ),
  ];
  if (tables.length !== 1) {
    fail(`expected exactly one rates table, found ${tables.length}`);
  }
  const body = tables[0][1];
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(body);
  if (!thead) fail('rates table has no header');
  const headers = [...thead[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(
    (m) => cellText(m[1]),
  );
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(body);
  if (!tbody) fail('rates table has no body');
  const rows = [...tbody[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) =>
      [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
        cellText(c[1]),
      ),
    )
    .filter((cells) => cells.length > 0);
  return { headers, rows };
}

function assertHeaders(actual: string[], expected: string[]) {
  if (
    actual.length !== expected.length ||
    actual.some((h, i) => h.toLowerCase() !== expected[i].toLowerCase())
  ) {
    fail(
      `unexpected table headers [${actual.join(', ')}] (expected [${expected.join(', ')}])`,
    );
  }
}

/** Validates one row and normalises it to per-unit decimals. */
function toQuote(
  label: string,
  buyText: string,
  sellText: string,
  effectiveDate: string,
  warnings: string[],
): FxQuote | null {
  const entry = CBE_LABELS[label.toLowerCase()];
  if (!entry) {
    // Schema-drift signal, not a new currency: never guess an ISO code.
    warnings.push(`Unknown CBE currency label "${label}" skipped.`);
    return null;
  }
  if (!DECIMAL_RE.test(buyText) || !DECIMAL_RE.test(sellText)) {
    fail(
      `non-decimal value for ${label}: buy "${buyText}", sell "${sellText}"`,
    );
  }
  const buy = new Prisma.Decimal(buyText);
  const sell = new Prisma.Decimal(sellText);
  if (buy.lte(0) || sell.lt(buy)) {
    fail(`${label}: expected 0 < buy ≤ sell, got ${buyText} / ${sellText}`);
  }
  const mid = buy.plus(sell).div(2);
  if (sell.minus(buy).div(mid).gte(MAX_SPREAD)) {
    fail(`${label}: buy/sell spread ≥ 2% (${buyText} / ${sellText})`);
  }
  return {
    code: entry.code,
    label,
    effectiveDate,
    buy: buy.div(entry.unitDivisor).toString(),
    sell: sell.div(entry.unitDivisor).toString(),
    unitDivisor: entry.unitDivisor,
  };
}

/** Latest page: `Rates for Date: dd/MM/yyyy` + [Currency | Buy | Sell]. */
export function parseCbeLatest(html: string): CbeParsed {
  const dates = [
    ...new Set(
      [...html.matchAll(/Rates for Date:\s*(\d{2}\/\d{2}\/\d{4})/gi)].map(
        (m) => m[1],
      ),
    ),
  ];
  if (dates.length !== 1) {
    fail(
      dates.length === 0
        ? 'the "Rates for Date" line is missing'
        : `conflicting "Rates for Date" lines (${dates.join(', ')})`,
    );
  }
  const effectiveDate = parseCbeDate(dates[0]);
  const { headers, rows } = extractTable(html);
  assertHeaders(headers, ['Currency', 'Buy', 'Sell']);
  const warnings: string[] = [];
  const quotes: FxQuote[] = [];
  const seen = new Set<string>();
  for (const cells of rows) {
    if (cells.length !== 3) fail(`row with ${cells.length} cells (expected 3)`);
    const quote = toQuote(
      cells[0],
      cells[1],
      cells[2],
      effectiveDate,
      warnings,
    );
    if (!quote) continue;
    if (seen.has(quote.code)) fail(`duplicate row for ${quote.code}`);
    seen.add(quote.code);
    quotes.push(quote);
  }
  const missing = CBE_REQUIRED_CODES.filter((code) => !seen.has(code));
  if (missing.length > 0) {
    fail(`required currencies missing: ${missing.join(', ')}`);
  }
  return { effectiveDates: [effectiveDate], quotes, warnings };
}

/** Historical fragment: [Date | Currency | Buy | Sell]; "no matching results" ⇒ empty. */
export function parseCbeHistorical(html: string): CbeParsed {
  if (!/id="api-data"/i.test(html)) {
    fail('historical response has no api-data container');
  }
  if (/There are no matching results/i.test(html)) {
    return { effectiveDates: [], quotes: [], warnings: [] };
  }
  const { headers, rows } = extractTable(html);
  assertHeaders(headers, ['Date', 'Currency', 'Buy', 'Sell']);
  const warnings: string[] = [];
  const quotes: FxQuote[] = [];
  const seen = new Set<string>();
  for (const cells of rows) {
    if (cells.length !== 4) fail(`row with ${cells.length} cells (expected 4)`);
    const date = parseCbeDate(cells[0]);
    const quote = toQuote(cells[1], cells[2], cells[3], date, warnings);
    if (!quote) continue;
    const key = `${quote.code}@${date}`;
    if (seen.has(key)) fail(`duplicate row for ${quote.code} on ${date}`);
    seen.add(key);
    quotes.push(quote);
  }
  const effectiveDates = [...new Set(quotes.map((q) => q.effectiveDate))]
    .sort()
    .reverse();
  return { effectiveDates, quotes, warnings };
}

export interface CbeHistoricalForm {
  action: string;
  fields: Record<string, string>;
}

/** Hidden fields of the historical form (token + CMS ids scraped every run, never hard-coded). */
export function parseCbeHistoricalForm(html: string): CbeHistoricalForm {
  const form =
    /<form\b[^>]*id="historicalDataForm"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form) fail('historical form not found');
  const action = /action="([^"]+)"/i.exec(form[0])?.[1];
  if (!action) fail('historical form has no action');
  const fields: Record<string, string> = {};
  for (const input of form[1].matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname="([^"]+)"/i.exec(input[0])?.[1];
    const value = /\bvalue="([^"]*)"/i.exec(input[0])?.[1];
    if (name && value !== undefined) fields[name] = decodeEntities(value);
  }
  for (const required of [
    '__RequestVerificationToken',
    'uid',
    'DataSourceId',
    'FallbackUrl',
    'LanguageName',
  ]) {
    if (!fields[required]) fail(`historical form field "${required}" missing`);
  }
  return { action: decodeEntities(action), fields };
}

/** 'YYYY-MM-DD' → CBE's required 'dd/MM/yyyy'. */
export function toCbeDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
