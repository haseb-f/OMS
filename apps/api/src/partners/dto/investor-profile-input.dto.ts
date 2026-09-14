import { IsOptional, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * INVESTOR-role configuration — sent alongside CreatePartnerDto/
 * UpdatePartnerDto when `roles` includes INVESTOR (Investor Engine
 * Milestone 1). Identity fields (name/phone/email/status/entityType) stay
 * on Partner; every field here stays optional — onboarding is deliberately
 * compact, no KYC checklist.
 */
export class InvestorProfileInputDto {
  @IsOptionalUuid()
  userId?: string;

  @IsString()
  @IsOptional()
  nationalId?: string;

  @IsString()
  @IsOptional()
  residencyId?: string;

  @IsString()
  @IsOptional()
  iban?: string;

  /** Investor Engine Milestone 4, Part A — Master Data Investor Type. Validated (exists + active for new assignment) in InvestorsService, not here. */
  @IsOptionalUuid()
  investorTypeId?: string;
}
