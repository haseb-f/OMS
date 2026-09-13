import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { DistributionPaymentStatus } from '@prisma/client';
import { TransformEnumList } from '../../common/query/enum-list';

export class FindDistributionPaymentsQueryDto {
  @IsUUID()
  @IsOptional()
  investorDistributionId?: string;

  @TransformEnumList()
  @IsEnum(DistributionPaymentStatus, { each: true })
  @IsOptional()
  status?: DistributionPaymentStatus[];

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
