import { Transform, Type } from 'class-transformer';
import {
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
import { AgentShippingService } from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/** One agreed charge: service × destination (all / country / country + city). */
export class ShippingAgreementRateDto {
  /** Required — a charge always names its service (no wildcard). */
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

  /** Optional starting rows (same rules as adding them one by one). */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingAgreementRateDto)
  @IsOptional()
  rates?: ShippingAgreementRateDto[];
}

/** DRAFT only. `effectiveTo: null` clears the end date (open-ended). */
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
