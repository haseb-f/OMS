import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";

type CurrencyRef = { id: string; code: string; name: string };

export interface ExchangeRateRow {
  id: string;
  fromCurrencyId: string;
  toCurrencyId: string;
  rate: string | number;
  effectiveDate: string;
  notes: string | null;
  /** CBE (automatic official import) | MANUAL | IMPORT | legacy values. */
  source: string;
  provider: string | null;
  buyRate: string | number | null;
  sellRate: string | number | null;
  sourceTimestamp: string | null;
  syncRunId: string | null;
  fromCurrency?: CurrencyRef;
  toCurrency?: CurrencyRef;
}

export interface FxRevaluationRunRow {
  id: string;
  runNumber: string;
  rateDate: string;
  status: "DRAFT" | "POSTED";
  notes: string | null;
}

/** A currency pair + date the Posting Engine needs a rate for — returned by
 *  the pre-posting check and carried by a MISSING_/STALE_EXCHANGE_RATE error. */
export interface RequiredExchangeRate {
  fromCurrencyId: string;
  toCurrencyId: string | null;
  fromCurrencyCode: string | null;
  toCurrencyCode: string | null;
  asOf: string;
}

export interface ExchangeRateCheck extends RequiredExchangeRate {
  required: boolean;
  available: boolean;
  rate: number | null;
  /** Date of the observation actually used (earlier than `asOf` on weekends/holidays). */
  effectiveDate: string | null;
  /** IDENTITY | OVERRIDE | CBE | MANUAL | IMPORT … */
  source: string | null;
  provider: string | null;
  overrideId: string | null;
  /** MISSING_EXCHANGE_RATE | STALE_EXCHANGE_RATE when not available. */
  errorCode: string | null;
  message: string | null;
}

export interface FxOverrideRow {
  id: string;
  fromCurrencyId: string;
  toCurrencyId: string;
  rate: string | number;
  dateFrom: string;
  dateTo: string;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
  deletedAt: string | null;
  fromCurrency?: CurrencyRef;
  toCurrency?: CurrencyRef;
}

export type FxRateBasis = "MID" | "BUY" | "SELL";
export type FxSyncRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";

export interface FxSyncSettings {
  id: string | null;
  enabled: boolean;
  provider: string;
  currencyCodes: string[];
  rateBasis: FxRateBasis;
  maxStaleDays: number;
  staleAlertDays: number;
  updatedAt: string | null;
}

export interface FxSyncRunRow {
  id: string;
  provider: string;
  /** CRON | MANUAL | BACKFILL */
  trigger: string;
  status: FxSyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  effectiveDate: string | null;
  fetchedCount: number;
  insertedCount: number;
  skippedCount: number;
  error: string | null;
  details: { reason?: string; slot?: string; warnings?: string[] } | null;
}

/** Cron slot: `primary` = daily import, `late` = evening catch-up (fetches only if today's rate is missing). */
export type FxCronSlot = "primary" | "late";
export type FxRateFreshness = "NONE" | "FRESH" | "AGING" | "STALE";

export interface FxSyncStatus {
  settings: FxSyncSettings;
  provider: string;
  scheduleUtcHours: number[];
  nextRuns: string[];
  /** Next cron fire with its slot (also while paused — the scheduler then records a SKIPPED row). */
  nextRun: { at: string; slot: FxCronSlot } | null;
  /** The live RUNNING row, if any (a dead one is never reported). */
  running: { id: string; trigger: string; startedAt: string } | null;
  /** Run now / repair are refused until this instant; null when allowed. */
  cooldownEndsAt: string | null;
  /** Server clock, so countdowns do not trust the browser clock. */
  serverNow: string;
  freshness: FxRateFreshness;
  lastRun: FxSyncRunRow | null;
  lastSuccess: FxSyncRunRow | null;
  /** Newest SUCCESS / PARTIAL / FAILED run — a later SKIPPED row never hides a failure. */
  lastAttempt?: FxSyncRunRow | null;
  newestEffectiveDate: string | null;
  newestAgeDays: number | null;
  staleAlert: boolean;
  today: string;
}

export const exchangeRatesService = {
  list: () => apiClient.get<ExchangeRateRow[]>("/exchange-rates"),
  check: (currencyId: string, asOf?: string) =>
    apiClient.get<ExchangeRateCheck>(
      `/exchange-rates/check?currencyId=${encodeURIComponent(currencyId)}${
        asOf ? `&asOf=${encodeURIComponent(asOf)}` : ""
      }`,
    ),
  /** Rate lookup tool — never throws for a missing/stale rate (see `available`). */
  resolve: (currencyId: string, asOf: string) =>
    apiClient.get<ExchangeRateCheck>(
      `/exchange-rates/resolve?currencyId=${encodeURIComponent(currencyId)}&asOf=${encodeURIComponent(asOf)}`,
    ),
  create: (dto: Record<string, unknown>) =>
    apiClient.post<ExchangeRateRow>("/exchange-rates", compactPayload(dto)),
};

export const fxOverridesService = {
  list: (fromCurrencyId?: string) =>
    apiClient.get<FxOverrideRow[]>(
      `/exchange-rates/overrides${
        fromCurrencyId ? `?fromCurrencyId=${encodeURIComponent(fromCurrencyId)}` : ""
      }`,
    ),
  create: (dto: {
    fromCurrencyId: string;
    rate: number;
    dateFrom: string;
    dateTo: string;
    reason: string;
  }) => apiClient.post<FxOverrideRow>("/exchange-rates/overrides", dto),
  /** Soft delete with a reason (never a hard delete). */
  remove: (id: string, reason: string) =>
    apiClient.post<FxOverrideRow>(`/exchange-rates/overrides/${id}/delete`, { reason }),
};

export const fxSyncService = {
  status: () => apiClient.get<FxSyncStatus>("/exchange-rates/sync/status"),
  runs: (limit = 20) => apiClient.get<FxSyncRunRow[]>(`/exchange-rates/sync/runs?limit=${limit}`),
  updateSettings: (
    dto: Partial<Pick<FxSyncSettings, "enabled" | "rateBasis" | "maxStaleDays" | "staleAlertDays">>,
  ) => apiClient.patch<FxSyncSettings>("/exchange-rates/sync/settings", dto),
  runNow: () => apiClient.post<FxSyncRunRow>("/exchange-rates/sync/run"),
  backfill: (days: number) =>
    apiClient.post<FxSyncRunRow>("/exchange-rates/sync/backfill", { days }),
};

export const fxRevaluationsService = {
  list: () => apiClient.get<FxRevaluationRunRow[]>("/fx-revaluations"),
  run: (dto: { rateDate: string; notes?: string }) =>
    apiClient.post<FxRevaluationRunRow>("/fx-revaluations/run", dto),
};
