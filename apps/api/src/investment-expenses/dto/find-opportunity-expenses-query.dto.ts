import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { OpportunityExpenseStatus } from '@prisma/client';

export class FindOpportunityExpensesQueryDto {
  @IsUUID()
  opportunityId!: string;

  @IsEnum(OpportunityExpenseStatus)
  @IsOptional()
  status?: OpportunityExpenseStatus;

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
