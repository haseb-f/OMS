import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { LeadSource } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class BulkAssignLeadsDto {
  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  leadIds?: string[];

  @IsUUID()
  salesEmployeeId!: string;

  @IsString()
  @IsOptional()
  reason?: string;

  /** Custom N — assign the first N matching unassigned leads (server-side). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  @IsOptional()
  count?: number;

  @IsBoolean()
  @IsOptional()
  unassignedOnly?: boolean;

  @IsOptionalUuid()
  countryId?: string;

  @IsString()
  @IsOptional()
  statusCode?: string;

  @IsOptional()
  source?: LeadSource;

  @IsString()
  @IsOptional()
  search?: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;
}
