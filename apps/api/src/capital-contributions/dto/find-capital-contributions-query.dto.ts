import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CapitalContributionStatus } from '@prisma/client';
import { TransformEnumList } from '../../common/query/enum-list';

export class FindCapitalContributionsQueryDto {
  @IsUUID()
  @IsOptional()
  subscriptionId?: string;

  @IsUUID()
  @IsOptional()
  opportunityId?: string;

  @IsUUID()
  @IsOptional()
  investorId?: string;

  @TransformEnumList()
  @IsEnum(CapitalContributionStatus, { each: true })
  @IsOptional()
  status?: CapitalContributionStatus[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number = 20;
}
