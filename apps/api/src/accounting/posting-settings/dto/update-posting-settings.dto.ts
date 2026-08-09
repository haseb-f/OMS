import { IsOptional, IsUUID } from 'class-validator';

export class UpdatePostingSettingsDto {
  @IsUUID()
  @IsOptional()
  salesRevenueAccountId?: string;

  @IsUUID()
  @IsOptional()
  salesDiscountAccountId?: string;

  @IsUUID()
  @IsOptional()
  salesReturnAccountId?: string;

  @IsUUID()
  @IsOptional()
  costOfGoodsSoldAccountId?: string;

  @IsUUID()
  @IsOptional()
  inventoryAccountId?: string;

  @IsUUID()
  @IsOptional()
  inventoryAdjustmentAccountId?: string;

  @IsUUID()
  @IsOptional()
  purchaseAccountId?: string;

  @IsUUID()
  @IsOptional()
  purchaseReturnAccountId?: string;

  @IsUUID()
  @IsOptional()
  accountsReceivableAccountId?: string;

  @IsUUID()
  @IsOptional()
  accountsPayableAccountId?: string;

  @IsUUID()
  @IsOptional()
  cashAccountId?: string;

  @IsUUID()
  @IsOptional()
  bankAccountId?: string;

  @IsUUID()
  @IsOptional()
  vatOutputAccountId?: string;

  @IsUUID()
  @IsOptional()
  vatInputAccountId?: string;

  @IsUUID()
  @IsOptional()
  roundDifferenceAccountId?: string;

  @IsUUID()
  @IsOptional()
  defaultExpenseAccountId?: string;

  @IsUUID()
  @IsOptional()
  purchaseDiscountAccountId?: string;

  @IsUUID()
  @IsOptional()
  exchangeDifferenceAccountId?: string;

  @IsUUID()
  @IsOptional()
  suspenseAccountId?: string;

  @IsUUID()
  @IsOptional()
  retainedEarningsAccountId?: string;
}
