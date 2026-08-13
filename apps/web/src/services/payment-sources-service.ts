import { apiClient } from "./api-client";

export interface PaymentSourceOption {
  id: string;
  name: string;
}

/** Minimal read accessor for the PaymentSource reference data ("how the customer paid") — used by Cash Flow reconciliation dialogs. No full CRUD master-data page exists on the frontend yet for this entity beyond `/finance/payment-sources`. */
export const paymentSourcesService = {
  list: () => apiClient.get<PaymentSourceOption[]>("/payment-sources"),
};
