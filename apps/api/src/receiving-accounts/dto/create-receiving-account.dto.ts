import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * "WHERE the money actually arrived" — the real accounting destination.
 * chartOfAccountId is required: "the accounting entry MUST ultimately use
 * the Receiving Account's ChartOfAccount." No gateway/provider fields.
 */
export class CreateReceivingAccountDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  /** No Company/multi-entity module exists yet — placeholder, not validated against anything. */
  @IsUUID()
  @IsOptional()
  companyId?: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  @IsUUID()
  chartOfAccountId!: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
