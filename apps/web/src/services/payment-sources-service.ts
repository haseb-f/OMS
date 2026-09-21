import { apiClient } from "./api-client";
import { cachedLookup } from "@/lib/lookup-cache";

export interface PaymentSourceOption {
  id: string;
  name: string;
  isActive?: boolean;
}

/** `/payment-sources` is a Master Data endpoint (paginated `{ items, ... }`); older builds returned a bare array — both shapes are accepted. */
type PaymentSourceListResponse = PaymentSourceOption[] | { items: PaymentSourceOption[] };

/**
 * The one read accessor for PaymentSource options ("how the customer paid")
 * used by every picker — receipts/payments editor, store-order dialogs and
 * Cash Flow reconciliation. Always returns a plain array of active sources.
 */
export const paymentSourcesService = {
  list: () =>
    cachedLookup("payment-sources:active", async () => {
      const response = await apiClient.get<PaymentSourceListResponse>(
        "/payment-sources?pageSize=500&sortBy=name",
      );
      const rows = Array.isArray(response) ? response : (response?.items ?? []);
      return rows.filter((row) => row.isActive !== false);
    }),
};
