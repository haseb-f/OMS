import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CreateExchangeRateDto {
  @IsUUID()
  fromCurrencyId!: string;

  @IsUUID()
  toCurrencyId!: string;

  @IsNumber()
  @Min(0.00000001)
  rate!: number;

  @IsDateString()
  effectiveDate!: string;

  /** MANUAL | IMPORT | PROVIDER — defaults to MANUAL. */
  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class BulkImportExchangeRatesDto {
  @IsArray()
  rows!: Array<{
    fromCurrencyId: string;
    toCurrencyId: string;
    rate: number;
    effectiveDate: string;
    notes?: string;
  }>;
}

export class ExchangeRateQueryDto {
  @IsOptionalUuid()
  fromCurrencyId?: string;

  @IsOptionalUuid()
  toCurrencyId?: string;

  @IsDateString()
  @IsOptional()
  asOf?: string;
}

export class RunFxRevaluationDto {
  @IsDateString()
  rateDate!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CheckExchangeRateQueryDto {
  @IsUUID()
  currencyId!: string;

  @IsDateString()
  @IsOptional()
  asOf?: string;
}

export class FxCorrectionDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;
}
