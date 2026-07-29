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

  @IsUUID()
  @IsOptional()
  salesEmployeeId?: string;

  @IsString()
  @IsOptional()
  importBatch?: string;
}
