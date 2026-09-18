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

export const exchangeRatesService = {
  list: () => apiClient.get<ExchangeRateRow[]>("/exchange-rates"),
  create: (dto: Record<string, unknown>) =>
    apiClient.post<ExchangeRateRow>("/exchange-rates", compactPayload(dto)),
};

export const fxRevaluationsService = {
  list: () => apiClient.get<FxRevaluationRunRow[]>("/fx-revaluations"),
  run: (dto: { rateDate: string; notes?: string }) =>
    apiClient.post<FxRevaluationRunRow>("/fx-revaluations/run", dto),
};
