import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { LeadSource } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

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
}
