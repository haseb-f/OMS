import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class UpdatePostingSettingsDto {
  @IsOptionalUuid()
  salesRevenueAccountId?: string;

  @IsOptionalUuid()
  salesDiscountAccountId?: string;

  @IsOptionalUuid()
  salesReturnAccountId?: string;

  @IsOptionalUuid()
  costOfGoodsSoldAccountId?: string;

  @IsOptionalUuid()
  inventoryAccountId?: string;

  @IsOptionalUuid()
  inventoryAdjustmentAccountId?: string;

  @IsOptionalUuid()
  purchaseAccountId?: string;

  @IsOptionalUuid()
  purchaseReturnAccountId?: string;

  @IsOptionalUuid()
  accountsReceivableAccountId?: string;

  @IsOptionalUuid()
  accountsPayableAccountId?: string;

  @IsOptionalUuid()
  cashAccountId?: string;

  @IsOptionalUuid()
  bankAccountId?: string;

  @IsOptionalUuid()
  vatOutputAccountId?: string;

  @IsOptionalUuid()
  vatInputAccountId?: string;

  @IsOptionalUuid()
  roundDifferenceAccountId?: string;

  @IsOptionalUuid()
  defaultExpenseAccountId?: string;

  @IsOptionalUuid()
  purchaseDiscountAccountId?: string;

  @IsOptionalUuid()
  exchangeDifferenceAccountId?: string;

  @IsOptionalUuid()
  suspenseAccountId?: string;

  @IsOptionalUuid()
  retainedEarningsAccountId?: string;

  @IsOptionalUuid()
  payrollPayableAccountId?: string;

  @IsOptionalUuid()
  salaryExpenseAccountId?: string;

  @IsOptionalUuid()
  kpiExpenseAccountId?: string;

  @IsOptionalUuid()
  commissionExpenseAccountId?: string;

  @IsOptionalUuid()
  defaultAllowanceExpenseAccountId?: string;

  @IsOptionalUuid()
  defaultDeductionAccountId?: string;

  @IsOptionalUuid()
  investorFundingAccountId?: string;

  @IsOptionalUuid()
  investorProfitDistributionAccountId?: string;

  @IsOptionalUuid()
  investorProfitPayableAccountId?: string;

  @IsOptionalUuid()
  capitalReturnAccountId?: string;

  @IsOptionalUuid()
  landedCostClearingAccountId?: string;

  @IsOptionalUuid()
  shippingExpenseAccountId?: string;

  @IsOptionalUuid()
  accruedShippingAccountId?: string;

  @IsOptionalUuid()
  paymentGatewayFeeAccountId?: string;

  @IsOptionalUuid()
  fulfillmentExpenseAccountId?: string;

  @IsOptionalUuid()
  accruedFulfillmentAccountId?: string;

  @IsOptionalUuid()
  fixedAssetsAccountId?: string;

  @IsOptionalUuid()
  accumDepreciationAccountId?: string;

  @IsOptionalUuid()
  depreciationExpenseAccountId?: string;

  @IsOptionalUuid()
  prepaymentsAccountId?: string;

  @IsOptionalUuid()
  accruedExpensesAccountId?: string;

  @IsOptionalUuid()
  unrealizedFxAccountId?: string;

  @IsOptionalUuid()
  otherIncomeAccountId?: string;

  @IsOptionalUuid()
  otherExpenseAccountId?: string;

  /** R13 — credit side of approved direct assembly costs (labour / overhead absorbed into finished-item cost). */
  @IsOptionalUuid()
  assemblyCostAccountId?: string;

  /** Agents milestone (D1) — liability holding what we owe agents (partner subledger). */
  @IsOptionalUuid()
  agentFundsPayableAccountId?: string;

  /** Agents milestone (D1) — revenue for commission charged to agents. */
  @IsOptionalUuid()
  agentCommissionRevenueAccountId?: string;

  /** Agents milestone (D1) — revenue for shipping/return/service fees charged to agents. */
  @IsOptionalUuid()
  agentServiceRevenueAccountId?: string;

  @IsOptionalUuid()
  functionalCurrencyId?: string;
}
