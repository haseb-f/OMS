import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CustomerSource, CustomerStatus } from '@prisma/client';

/**
 * `defaultReceivableAccountId` is "(nullable placeholder only)" — no FK, no
 * business logic, no API, no validation (same ADR-0012/ADR-0015 precedent
 * Supplier's own default account columns follow) — not exposed here, schema
 * column only.
 */
export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  commercialName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  taxNumber?: string;

  @IsString()
  @IsOptional()
  commercialRegistration?: string;

  @IsUUID()
  @IsOptional()
  customerGroupId?: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  @IsUUID()
  @IsOptional()
  paymentTermId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;

  @IsUUID()
  @IsOptional()
  countryId?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;

  /** Defaults to MANUAL in the service when omitted — set explicitly to
   * LEAD_CONVERSION by the Lead "Convert to Customer" action. */
  @IsEnum(CustomerSource)
  @IsOptional()
  source?: CustomerSource;
}
