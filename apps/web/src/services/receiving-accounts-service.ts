import { apiClient } from "./api-client";
import { cachedLookup } from "@/lib/lookup-cache";

export interface ReceivingAccountOption {
  id: string;
  name: string;
  isActive?: boolean;
  isDefault?: boolean;
  currencyId?: string | null;
}

type ReceivingAccountListResponse = ReceivingAccountOption[] | { items: ReceivingAccountOption[] };

/** The one read accessor for ReceivingAccount options ("where the money arrived"). Accepts a bare array or a paginated `{ items }` response and always returns the active accounts. */
export const receivingAccountsService = {
  list: () =>
    cachedLookup("receiving-accounts:active", async () => {
      const response = await apiClient.get<ReceivingAccountListResponse>("/receiving-accounts");
      const rows = Array.isArray(response) ? response : (response?.items ?? []);
      return rows.filter((row) => row.isActive !== false);
    }),
};
