/**
 * One official quotation, already normalised to the OMS canonical
 * convention "1 FOREIGN = X functional (EGP)" — per-unit, never per-100.
 */
export interface FxQuote {
  /** ISO 4217 code of the foreign currency. */
  code: string;
  /** Label exactly as published by the source (provenance). */
  label: string;
  /** Publication date of the rate (source calendar date, 'YYYY-MM-DD'). */
  effectiveDate: string;
  /** EGP per 1 unit, as decimal strings (exact, never float-rounded). */
  buy: string;
  sell: string;
  /** Units the source quoted per (e.g. 100 for "Japanese Yen 100"); buy/sell above are already divided. */
  unitDivisor: number;
}

export interface FxProviderResult {
  provider: string;
  /** Quote currency of every row (CBE: EGP). */
  quoteCurrency: string;
  /** Publication date(s) covered, newest first. */
  effectiveDates: string[];
  /** Source-reported publication timestamp when available (CBE publishes a date only). */
  sourceTimestamp: Date | null;
  fetchedAt: Date;
  quotes: FxQuote[];
  /** Non-fatal observations (e.g. a label outside the closed dictionary, skipped). */
  warnings: string[];
  /** sha256 of the raw payload (audit / revision detection). */
  rawHash: string;
  sourceUrl: string;
}

/** Adapter for one official rate publisher. */
export interface FxRateProvider {
  readonly name: string;
  fetchLatest(): Promise<FxProviderResult>;
  /** Historical range (inclusive, 'YYYY-MM-DD'); optional per provider. */
  fetchHistorical?(dateFrom: string, dateTo: string): Promise<FxProviderResult>;
}

/** Nest DI token for the active provider (CBE by default; tests inject a fake). */
export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');

export type FxProviderErrorKind =
  'NETWORK' | 'HTTP' | 'BLOCKED' | 'PARSE' | 'VALIDATION';

/** A fetch or payload that failed strict validation — nothing from it may be stored. */
export class FxProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: FxProviderErrorKind = 'PARSE',
  ) {
    super(message);
    this.name = 'FxProviderError';
  }
}
