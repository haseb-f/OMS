import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class FindInvestorSubscriptionsQueryDto {
  @IsUUID()
  @IsOptional()
  opportunityId?: string;

  @IsUUID()
  @IsOptional()
  investorId?: string;

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
