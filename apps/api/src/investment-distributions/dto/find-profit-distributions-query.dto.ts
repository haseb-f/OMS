import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ProfitDistributionStatus } from '@prisma/client';
import { TransformEnumList } from '../../common/query/enum-list';

export class FindProfitDistributionsQueryDto {
  @IsUUID()
  @IsOptional()
  opportunityId?: string;

  @IsUUID()
  @IsOptional()
  investorId?: string;

  @TransformEnumList()
  @IsEnum(ProfitDistributionStatus, { each: true })
  @IsOptional()
  status?: ProfitDistributionStatus[];

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
