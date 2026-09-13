import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { PartnerEntityType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * Investor Engine Milestone 1, Phase 4 — deliberately compact onboarding
 * (no KYC workflow, no wizard): Name, Type, Phone OR Email, Status, plus
 * optional ID/CR/IBAN/Notes. `name` doubles as both Partner.name/displayName
 * — a single identity field, not two.
 */
export class CreateInvestorDto {
  @IsString()
  name!: string;

  @IsEnum(PartnerEntityType)
  @IsOptional()
  entityType?: PartnerEntityType;

  @IsString()
  @ValidateIf((dto: CreateInvestorDto) => !dto.email)
  phone?: string;

  @IsEmail()
  @ValidateIf((dto: CreateInvestorDto) => !dto.phone)
  email?: string;

  @IsString()
  @IsOptional()
  commercialRegistration?: string;

  @IsString()
  @IsOptional()
  nationalId?: string;

  @IsString()
  @IsOptional()
  residencyId?: string;

  @IsString()
  @IsOptional()
  iban?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptionalUuid()
  userId?: string;
}
