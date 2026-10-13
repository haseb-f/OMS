import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Upper bound of employee cards per page (R20 §B). */
export const MAX_EMPLOYEE_PERIODS_PAGE_SIZE = 50;
export const DEFAULT_EMPLOYEE_PERIODS_PAGE_SIZE = 10;

/** `GET /sales-reports/employee-periods` (and the agent-portal copy). */
export class EmployeePeriodsQueryDto {
  /** 1-based page of employees (ordered by this month's rank). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_EMPLOYEE_PERIODS_PAGE_SIZE)
  @IsOptional()
  pageSize?: number;
}
