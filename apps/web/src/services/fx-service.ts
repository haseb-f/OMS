import { apiClient } from "./api-client";
import { compactPayload } from "@/lib/compact-payload";

export interface ExchangeRateRow {
  id: string;
  fromCurrencyId: string;
  toCurrencyId: string;
  rate: string | number;
  effectiveDate: string;
  notes: string | null;
  fromCurrency?: { id: string; code: string; name: string };
  toCurrency?: { id: string; code: string; name: string };
}

export interface FxRevaluationRunRow {
  id: string;
  runNumber: string;
  rateDate: string;
  status: "DRAFT" | "POSTED";
  notes: string | null;
}

/** A currency pair + date the Posting Engine needs a rate for — returned by
 *  the pre-posting check and carried by a MISSING_EXCHANGE_RATE error. */
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
}

export const exchangeRatesService = {
  list: () => apiClient.get<ExchangeRateRow[]>("/exchange-rates"),
  check: (currencyId: string, asOf?: string) =>
    apiClient.get<ExchangeRateCheck>(
      `/exchange-rates/check?currencyId=${encodeURIComponent(currencyId)}${
        asOf ? `&asOf=${encodeURIComponent(asOf)}` : ""
      }`,
    ),
  create: (dto: Record<string, unknown>) =>
    apiClient.post<ExchangeRateRow>("/exchange-rates", compactPayload(dto)),
};

export const fxRevaluationsService = {
  list: () => apiClient.get<FxRevaluationRunRow[]>("/fx-revaluations"),
  run: (dto: { rateDate: string; notes?: string }) =>
    apiClient.post<FxRevaluationRunRow>("/fx-revaluations/run", dto),
};
