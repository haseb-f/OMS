import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CompanyPartnerStatus,
  PartnerAgreementFrequency,
  PartnerProfitBasis,
} from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { toNormalizedEmail } from '../../auth/password.util';

/** Business (Africa/Cairo) calendar date, "YYYY-MM-DD". */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a date (YYYY-MM-DD)';

/**
 * A company partner = an existing Partner (`partnerId`) or a new one
 * (`name`, optional phone / email); either way it gains the OWNER role.
 */
export class CreateCompanyPartnerDto {
  @IsOptionalUuid()
  partnerId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  /** Legal ownership — informational only, never used in the profit calculation. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  @IsOptional()
  ownershipPercent?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateCompanyPartnerDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  @IsOptional()
  ownershipPercent?: number | null;

  @IsString()
  @IsOptional()
  notes?: string | null;

  @IsEnum(CompanyPartnerStatus)
  @IsOptional()
  status?: CompanyPartnerStatus;
}

export class CreatePartnerAgreementDto {
  @IsUUID()
  partnerId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100)
  profitSharePercent!: number;

  @IsEnum(PartnerProfitBasis)
  basis!: PartnerProfitBasis;

  @Matches(DATE_ONLY, { message: `effectiveFrom ${DATE_MESSAGE}` })
  effectiveFrom!: string;

  @Matches(DATE_ONLY, { message: `effectiveTo ${DATE_MESSAGE}` })
  @IsOptional()
  effectiveTo?: string;

  @IsEnum(PartnerAgreementFrequency)
  frequency!: PartnerAgreementFrequency;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Activate immediately (the usual path); false keeps a DRAFT. */
  @IsOptional()
  @IsIn([true, false])
  activate?: boolean;
}

export class UpdatePartnerAgreementDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100)
  @IsOptional()
  profitSharePercent?: number;

  @IsEnum(PartnerProfitBasis)
  @IsOptional()
  basis?: PartnerProfitBasis;

  @Matches(DATE_ONLY, { message: `effectiveFrom ${DATE_MESSAGE}` })
  @IsOptional()
  effectiveFrom?: string;

  @Matches(DATE_ONLY, { message: `effectiveTo ${DATE_MESSAGE}` })
  @IsOptional()
  effectiveTo?: string | null;

  @IsEnum(PartnerAgreementFrequency)
  @IsOptional()
  frequency?: PartnerAgreementFrequency;

  @IsString()
  @IsOptional()
  notes?: string | null;
}

export class EndPartnerAgreementDto {
  /** Last day the agreement is in force (inclusive). */
  @Matches(DATE_ONLY, { message: `effectiveTo ${DATE_MESSAGE}` })
  effectiveTo!: string;
}

/** End the current agreement the day before `effectiveFrom` and start the new terms. */
export class SupersedePartnerAgreementDto {
  @Matches(DATE_ONLY, { message: `effectiveFrom ${DATE_MESSAGE}` })
  effectiveFrom!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(100)
  profitSharePercent!: number;

  @IsEnum(PartnerProfitBasis)
  @IsOptional()
  basis?: PartnerProfitBasis;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class PartnerProfitRangeQueryDto {
  @Matches(DATE_ONLY, { message: `from ${DATE_MESSAGE}` })
  from!: string;

  @Matches(DATE_ONLY, { message: `to ${DATE_MESSAGE}` })
  to!: string;
}

export class PartnerStatementQueryDto {
  @Matches(DATE_ONLY, { message: `from ${DATE_MESSAGE}` })
  @IsOptional()
  from?: string;

  @Matches(DATE_ONLY, { message: `to ${DATE_MESSAGE}` })
  @IsOptional()
  to?: string;
}

export class SavePartnerProfitPeriodDto {
  @Matches(DATE_ONLY, { message: `periodFrom ${DATE_MESSAGE}` })
  periodFrom!: string;

  @Matches(DATE_ONLY, { message: `periodTo ${DATE_MESSAGE}` })
  periodTo!: string;
}

export class AdjustPartnerProfitPeriodDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class CreatePartnerPaymentDto {
  @IsUUID()
  partnerId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @Matches(DATE_ONLY, { message: `date ${DATE_MESSAGE}` })
  date!: string;

  @IsUUID()
  financialAccountId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReversePartnerPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class FindPartnerPaymentsQueryDto {
  @IsOptionalUuid()
  partnerId?: string;
}

export class FindPartnerAgreementsQueryDto {
  @IsOptionalUuid()
  partnerId?: string;
}

/** R15 (D15-14) — a partner's own login: e-mail (also the username) and display name. */
export class CreatePartnerLoginDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName!: string;
}

/** Link an existing, currently unlinked partner login to this partner. */
export class LinkPartnerLoginDto {
  @IsUUID()
  userId!: string;
}

export class PartnerLoginCandidatesQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;
}
