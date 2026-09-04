import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { LeadSource } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

export const LEAD_LIFECYCLE_FILTERS = [
  'active',
  'converted',
  'closed',
  'all',
] as const;
export type LeadLifecycleFilter = (typeof LEAD_LIFECYCLE_FILTERS)[number];

export class FindLeadsQueryDto extends MasterDataQueryDto {
  @IsString()
  @IsOptional()
  statusCode?: string;

  @IsUUID()
  @IsOptional()
  salesEmployeeId?: string;

  @IsUUID()
  @IsOptional()
  countryId?: string;

  @IsUUID()
  @IsOptional()
  teamId?: string;

  @IsEnum(LeadSource)
  @IsOptional()
  source?: LeadSource;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  unassigned?: boolean;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @IsUUID()
  @IsOptional()
  partnerId?: string;

  @IsIn(LEAD_LIFECYCLE_FILTERS)
  @IsOptional()
  lifecycle?: LeadLifecycleFilter;

  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    return Array.isArray(value) ? value : String(value).split(',');
  })
  @IsUUID('4', { each: true })
  @IsOptional()
  classificationIds?: string[];
}
