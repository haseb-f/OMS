import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * "HOW the customer paid" — a reference-data label only. No gateway
 * credentials, API keys, URLs, webhook fields, provider settings, or
 * authentication belong here. `feePercentage`/`feeFixedAmount` (ADR-0018)
 * are the one exception: plain numbers, never a provider name or secret —
 * the same category of business configuration as `defaultChartOfAccountId`
 * below, not a gateway integration setting.
 */
export class CreatePaymentSourceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** Optional default suggestion only — never the actual accounting destination. */
  @IsOptionalUuid()
  defaultChartOfAccountId?: string;

  /** Optional fee ESTIMATION config (ADR-0018) — a real Payment's own actualFeeAmount always supersedes this. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  feePercentage?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  feeFixedAmount?: number;
}
