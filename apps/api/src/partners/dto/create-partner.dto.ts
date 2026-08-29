import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  PartnerEntityType,
  PartnerRoleType,
  PartnerSource,
  PartnerStatus,
} from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { CustomerProfileInputDto } from './customer-profile-input.dto';
import { SupplierProfileInputDto } from './supplier-profile-input.dto';
import { EmployeeProfileInputDto } from './employee-profile-input.dto';

/**
 * Unified Partner Architecture — one identity, multiple roles (spec sections
 * 4-8/13). `roles` is required and non-empty: a Partner must have at least
 * one reason to exist in OMS. The matching `*ProfileInputDto` is read only
 * when its role is present in `roles` — PartnersService silently ignores a
 * profile object for a role that wasn't requested rather than erroring,
 * since the frontend's multi-select checkboxes may submit a profile object
 * left over from a toggled-off role.
 */
export class CreatePartnerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  legalName?: string;

  @IsString()
  @IsOptional()
  commercialName?: string;

  @IsEnum(PartnerEntityType)
  @IsOptional()
  entityType?: PartnerEntityType;

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

  @IsEnum(PartnerStatus)
  @IsOptional()
  status?: PartnerStatus;

  /** Defaults to MANUAL in the service when omitted — set explicitly to LEAD_CONVERSION by the Lead "Convert to Partner" action. */
  @IsEnum(PartnerSource)
  @IsOptional()
  source?: PartnerSource;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(PartnerRoleType, { each: true })
  roles!: PartnerRoleType[];

  @ValidateNested()
  @Type(() => CustomerProfileInputDto)
  @IsOptional()
  customerProfile?: CustomerProfileInputDto;

  @ValidateNested()
  @Type(() => SupplierProfileInputDto)
  @IsOptional()
  supplierProfile?: SupplierProfileInputDto;

  @ValidateNested()
  @Type(() => EmployeeProfileInputDto)
  @IsOptional()
  employeeProfile?: EmployeeProfileInputDto;
}
