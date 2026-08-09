import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { LeadSource } from '@prisma/client';

/** A UI form's untouched "no selection" Select value — normalized to `undefined` so `@IsOptional()` actually skips validation for it (an empty string is not `null`/`undefined`, so it would otherwise still be checked against `@IsUUID()`/`@IsString()`). */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  /** International format (e.g. +201000000000) — not tied to a specific country. */
  @IsPhoneNumber()
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
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsUUID()
  currencyId!: string;

  @IsEnum(LeadSource)
  source!: LeadSource;

  @Transform(emptyToUndefined)
  @IsUUID()
  @IsOptional()
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
