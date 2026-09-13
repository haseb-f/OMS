import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** Investor Engine Milestone 3, Phase 19/51 — the 4 Investor Accounting Settings fields, exposed through their own dedicated, more sensitive permission (`investment-accounting.configure`) rather than the broad `fiscal-configuration.manage` every other default account shares. */
export class UpdateInvestorAccountingSettingsDto {
  @IsOptionalUuid()
  investorFundingAccountId?: string;

  @IsOptionalUuid()
  investorProfitDistributionAccountId?: string;

  @IsOptionalUuid()
  investorProfitPayableAccountId?: string;

  @IsOptionalUuid()
  capitalReturnAccountId?: string;
}
