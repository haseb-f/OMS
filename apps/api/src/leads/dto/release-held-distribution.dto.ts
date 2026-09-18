import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadDistributionMode } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class ReleaseHeldDistributionDto {
  @IsOptional()
  @IsString()
  importBatch?: string;

  @IsOptional()
  @IsEnum(LeadDistributionMode)
  mode?: LeadDistributionMode;

  @IsOptionalUuid()
  salesEmployeeId?: string;
}
