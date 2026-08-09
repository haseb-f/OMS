import { apiClient } from "./api-client";

export interface AccountRef {
  id: string;
  code: string;
  name: string;
}

export interface AccountingSettingsRow {
  id: string;
  salesRevenueAccountId: string | null;
  salesRevenueAccount: AccountRef | null;
  salesDiscountAccountId: string | null;
  salesDiscountAccount: AccountRef | null;
  salesReturnAccountId: string | null;
  salesReturnAccount: AccountRef | null;
  costOfGoodsSoldAccountId: string | null;
  costOfGoodsSoldAccount: AccountRef | null;
  inventoryAccountId: string | null;
  inventoryAccount: AccountRef | null;
  inventoryAdjustmentAccountId: string | null;
  inventoryAdjustmentAccount: AccountRef | null;
  purchaseAccountId: string | null;
  purchaseAccount: AccountRef | null;
  purchaseReturnAccountId: string | null;
  purchaseReturnAccount: AccountRef | null;
  accountsReceivableAccountId: string | null;
  accountsReceivableAccount: AccountRef | null;
  accountsPayableAccountId: string | null;
  accountsPayableAccount: AccountRef | null;
  cashAccountId: string | null;
  cashAccount: AccountRef | null;
  bankAccountId: string | null;
  bankAccount: AccountRef | null;
  vatOutputAccountId: string | null;
  vatOutputAccount: AccountRef | null;
  vatInputAccountId: string | null;
  vatInputAccount: AccountRef | null;
  roundDifferenceAccountId: string | null;
  roundDifferenceAccount: AccountRef | null;
  defaultExpenseAccountId: string | null;
  defaultExpenseAccount: AccountRef | null;
  purchaseDiscountAccountId: string | null;
  purchaseDiscountAccount: AccountRef | null;
  exchangeDifferenceAccountId: string | null;
  exchangeDifferenceAccount: AccountRef | null;
  suspenseAccountId: string | null;
  suspenseAccount: AccountRef | null;
  retainedEarningsAccountId: string | null;
  retainedEarningsAccount: AccountRef | null;
}

export type AccountingSettingsField = Extract<keyof AccountingSettingsRow, `${string}Id`>;

export type UpdateAccountingSettingsPayload = Partial<
  Record<AccountingSettingsField, string | null>
>;

/**
 * Accounting Configuration (TASK-047) — the global Accounting Settings
 * every Posting Provider falls back to (via `AccountMappingService`) once
 * Product Category / Customer Group / Supplier Group / Tax overrides have
 * none of their own. Backed by the same `/accounting/posting-settings`
 * endpoint TASK-046 built (now covering all 20 fields — TASK-055 added
 * Purchase Discount/Exchange Difference/Suspense/Retained Earnings).
 */
export const accountingSettingsService = {
  get: () => apiClient.get<AccountingSettingsRow>("/accounting/posting-settings"),
  update: (dto: UpdateAccountingSettingsPayload) =>
    apiClient.patch<AccountingSettingsRow>("/accounting/posting-settings", dto),
};
