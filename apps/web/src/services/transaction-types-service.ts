import { createMasterDataService } from "./master-data-service";

export type TransactionDirectionValue = "IN" | "OUT";

export type TransactionNatureValue = "STANDARD" | "TRANSFER";

export type TransactionMatchingTargetValue =
  | "STORE_ORDER"
  | "SALES_INVOICE"
  | "PURCHASE_INVOICE"
  | "CUSTOMER"
  | "VENDOR"
  | "EMPLOYEE"
  | "FINANCIAL_ACCOUNT"
  | "EXPENSE_ACCOUNT"
  | "LIABILITY"
  | "EQUITY_OR_PARTNER"
  | "INVESTMENT"
  | "ACCOUNT";

export type TransactionAccountingTreatmentValue =
  | "OPERATING_REVENUE"
  | "OPERATING_EXPENSE"
  | "EQUITY_MOVEMENT"
  | "LIABILITY_MOVEMENT"
  | "TRANSFER"
  | "NEUTRAL";

export interface TransactionTypeRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  direction: TransactionDirectionValue;
  nature: TransactionNatureValue;
  matchingTarget: TransactionMatchingTargetValue | null;
  isSystem: boolean;
  isActive: boolean;
  defaultAccountingTreatment: TransactionAccountingTreatmentValue;
  defaultAccountId: string | null;
  defaultAccount?: { id: string; code: string; name: string } | null;
  sortOrder: number;
  deletedAt: string | null;
}

export const transactionTypesService =
  createMasterDataService<TransactionTypeRow>("/transaction-types");
