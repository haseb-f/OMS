import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { LeadSource } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** A UI form's untouched "no selection" Select value — normalized to `undefined` so `@IsOptional()` actually skips validation for it (an empty string is not `null`/`undefined`, so it would otherwise still be checked against `@IsUUID()`/`@IsString()`). */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  /**
   * Any common representation (local "0501234567", international
   * "+966501234567", or "00966501234567") — `PhoneNumberService` in
   * `LeadsService.create()` parses this against `countryId`'s ISO2 code and
   * rejects/normalizes it there, where country context is available. A bare
   * `@IsPhoneNumber()` here would wrongly reject valid local-format input.
   */
  @IsString()
  @IsNotEmpty()
  mobileNumber!: string;

  @IsUUID()
  countryId!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  /** No Product entity/module exists yet — reserved for future integration, not a foreign key. */
  @IsOptionalUuid()
  productId?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsUUID()
  currencyId!: string;

  @IsEnum(LeadSource)
  source!: LeadSource;

  @Transform(emptyToUndefined)
  @IsOptionalUuid()
  salesEmployeeId?: string;

  @IsString()
  @IsOptional()
  importBatch?: string;

  /** The source system's own order identifier — used to detect a re-imported duplicate order (see LeadsService.create). */
  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  externalOrderId?: string;
}
