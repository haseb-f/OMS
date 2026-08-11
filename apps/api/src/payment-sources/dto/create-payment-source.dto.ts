import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

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
  @IsOptionalUuid()
  defaultChartOfAccountId?: string;
}
