import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Matches,
  Max,
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

/** Dated manual override: 1 FOREIGN = rate functional for every day of [dateFrom, dateTo] (inclusive). */
export class CreateFxOverrideDto {
  @IsUUID()
  fromCurrencyId!: string;

  /** Optional; must be the functional currency when given. */
  @IsOptionalUuid()
  toCurrencyId?: string;

  @IsNumber()
  @Min(0.00000001)
  rate!: number;

  @IsDateString()
  dateFrom!: string;

  @IsDateString()
  dateTo!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class DeleteFxOverrideDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class FxOverrideQueryDto {
  @IsOptionalUuid()
  fromCurrencyId?: string;

  /** Only overrides whose range contains this date. */
  @IsDateString()
  @IsOptional()
  asOf?: string;

  @IsIn(['true', 'false'])
  @IsOptional()
  includeDeleted?: string;
}

export class ResolveRateQueryDto {
  @IsUUID()
  currencyId!: string;

  @IsDateString()
  asOf!: string;
}

export class UpdateFxSyncSettingsDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsIn(['MID', 'BUY', 'SELL'])
  @IsOptional()
  rateBasis?: 'MID' | 'BUY' | 'SELL';

  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  maxStaleDays?: number;

  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  staleAlertDays?: number;

  /** ISO codes to import; empty = every published currency that exists here. */
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[A-Z]{3}$/, { each: true })
  @IsOptional()
  currencyCodes?: string[];
}

export class FxBackfillDto {
  /** Calendar days back from today (Cairo), 1–7 per run (serverless time budget). */
  @IsInt()
  @Min(1)
  @Max(7)
  days!: number;
}
