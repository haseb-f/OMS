import { apiClient } from "./api-client";
import type {
  FinancialTransactionDirection,
  FinancialTransactionTypeCode,
} from "@/config/financial-transactions/transaction-type";

export interface FinancialTransactionTypeRow {
  code: FinancialTransactionTypeCode;
  label: string;
  direction: FinancialTransactionDirection;
  isSystem: boolean;
}

export const financialTransactionTypesService = {
  list: (direction?: FinancialTransactionDirection) =>
    apiClient.get<FinancialTransactionTypeRow[]>(
      `/financial-transactions/types${direction ? `?direction=${direction}` : ""}`,
    ),
};
