import { IsEnum } from 'class-validator';
import { LeadDistributionMode } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class ActivateDistributionDto {
  @IsEnum(LeadDistributionMode)
  mode!: LeadDistributionMode;

  @IsOptionalUuid()
  teamId?: string;

  @IsOptionalUuid()
  departmentId?: string;
}
