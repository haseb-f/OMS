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
}
