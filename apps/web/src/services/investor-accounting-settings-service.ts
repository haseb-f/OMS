import { apiClient } from "./api-client";
import type { AccountRef } from "./accounting-settings-service";

export interface InvestorAccountingSettingsRow {
  id: string;
  investorFundingAccountId: string | null;
  investorFundingAccount: AccountRef | null;
  investorProfitDistributionAccountId: string | null;
  investorProfitDistributionAccount: AccountRef | null;
  investorProfitPayableAccountId: string | null;
  investorProfitPayableAccount: AccountRef | null;
  capitalReturnAccountId: string | null;
  capitalReturnAccount: AccountRef | null;
}

export type InvestorAccountingSettingsField = Extract<
  keyof InvestorAccountingSettingsRow,
  `${string}Id`
>;

export type UpdateInvestorAccountingSettingsPayload = Partial<
  Record<InvestorAccountingSettingsField, string | null>
>;

/**
 * Investor Engine Milestone 3, Phase 19/51 — same singleton PostingSettings
 * row the general Accounting Settings page reads, but served through its
 * own permission-gated endpoint (`investment-accounting.configure`) since
 * this mapping is more sensitive than the rest of Finance's day-to-day
 * Investor operations.
 */
export const investorAccountingSettingsService = {
  get: () => apiClient.get<InvestorAccountingSettingsRow>("/investment-accounting-settings"),
  update: (dto: UpdateInvestorAccountingSettingsPayload) =>
    apiClient.patch<InvestorAccountingSettingsRow>("/investment-accounting-settings", dto),
};
