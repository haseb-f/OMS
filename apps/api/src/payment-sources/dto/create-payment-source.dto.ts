import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * "HOW the customer paid" — a reference-data label only. No gateway
 * credentials, API keys, URLs, webhook fields, provider settings, or
 * authentication belong here.
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
  @IsUUID()
  @IsOptional()
  defaultChartOfAccountId?: string;
}
