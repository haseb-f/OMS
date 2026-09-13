import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CapitalReturnStatus } from '@prisma/client';
import { TransformEnumList } from '../../common/query/enum-list';

export class FindCapitalReturnsQueryDto {
  @IsUUID()
  @IsOptional()
  investorId?: string;

  @IsUUID()
  @IsOptional()
  subscriptionId?: string;

  @IsUUID()
  @IsOptional()
  opportunityId?: string;

  @TransformEnumList()
  @IsEnum(CapitalReturnStatus, { each: true })
  @IsOptional()
  status?: CapitalReturnStatus[];

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
