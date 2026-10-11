import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgentShippingCodFeeMode, AgentShippingService } from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/** R17 §3 — COD collection fee: fixed, agreement currency; null / '' = none. */
const codCollectionFeeValue = ({ value }: { value: unknown }): unknown =>
  value === '' || value === null ? null : value;

/** One agreed charge: service × destination (all / country / country + city). */
export class ShippingAgreementRateDto {
  /**
   * Required — a charge always names its service; `ANY` (R17 §3) is the
   * default row that prices every service.
   */
  @IsEnum(AgentShippingService)
  service!: AgentShippingService;

  /** Omitted = all destinations. */
  @IsOptionalUuid()
  countryId?: string;

  /** Omitted / empty = the whole country. Needs a country. */
  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  /** 0 = explicitly free (allowed); never negative. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  /**
   * R17 §3 — COD orders priced by this row: ADDED (default) = amount + the
   * agreement's COD collection fee; INCLUDED = the amount is all-inclusive.
   */
  @IsEnum(AgentShippingCodFeeMode)
  @IsOptional()
  codFee?: AgentShippingCodFeeMode;
}

export class CreateShippingAgreementDto {
  /** Cairo calendar date ("YYYY-MM-DD"), inclusive. */
  @IsDateString()
  effectiveFrom!: string;

  /** Inclusive; omitted = open-ended. */
  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  effectiveTo?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  /** R17 §3 — optional fixed COD collection fee (agreement currency). */
  @Transform(codCollectionFeeValue)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  codCollectionFee?: number | null;

  /** Optional starting rows (same rules as adding them one by one). */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingAgreementRateDto)
  @IsOptional()
  rates?: ShippingAgreementRateDto[];
}

/**
 * R17 §2 — "Edit" on the ACTIVE agreement: the complete new terms (rates
 * replace the current list). Saved as a new version in force from the save
 * instant; the current version closes at that same instant.
 */
export class ShippingAgreementVersionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShippingAgreementRateDto)
  rates!: ShippingAgreementRateDto[];

  @Transform(codCollectionFeeValue)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  codCollectionFee?: number | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string | null;
}

/**
 * DRAFT only. `effectiveTo: null` clears the end date (open-ended); `rates`
 * (R17 compact form) replaces every row of the draft when present.
 */
export class UpdateShippingAgreementDto {
  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @Transform(({ value }: { value: unknown }) => (value === '' ? null : value))
  @IsDateString()
  @IsOptional()
  effectiveTo?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string | null;

  @Transform(codCollectionFeeValue)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  codCollectionFee?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingAgreementRateDto)
  @IsOptional()
  rates?: ShippingAgreementRateDto[];
}

export class DuplicateShippingAgreementDto {
  /** Defaults to tomorrow (Cairo). */
  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;
}

export class ActivateShippingAgreementDto {
  /**
   * Replace the ACTIVE agreement that overlaps from this agreement's start
   * date: it is closed the day before (only when it started earlier).
   */
  @IsBoolean()
  @IsOptional()
  replaceFrom?: boolean;
}

export class DeactivateShippingAgreementDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
