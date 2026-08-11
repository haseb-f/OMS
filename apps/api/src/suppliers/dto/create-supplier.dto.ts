import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SupplierStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * Default Payable/Expense Account are "(nullable placeholder only)" — no
 * FK, no business logic, no API, no validation (ADR-0012 precedent) — not
 * exposed here, schema columns only.
 */
export class CreateSupplierDto {
  /**
   * "Editable by user, unique" — distinct from the auto-generated
   * supplierNumber. Optional here (TASK-048): the UX Policy's "generate
   * codes automatically, never require the user to type one manually"
   * applies to the Supplier Quick-Create flow, so `SuppliersService.create`
   * defaults `code` to the minted `supplierNumber` when omitted — the
   * full Supplier form still lets a user type/edit their own.
   */
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  code?: string;

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

  @IsOptionalUuid()
  currencyId?: string;

  /** TASK-047 — same treatment as Customer.customerGroupId; also drives Accounting Configuration group-level account-mapping overrides. */
  @IsOptionalUuid()
  supplierGroupId?: string;

  /** No closed set of values specified — free-text. */
  @IsString()
  @IsOptional()
  paymentTerm?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;

  @IsOptionalUuid()
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

  @IsEnum(SupplierStatus)
  @IsOptional()
  status?: SupplierStatus;

  @IsBoolean()
  @IsOptional()
  isPreferred?: boolean;
}
