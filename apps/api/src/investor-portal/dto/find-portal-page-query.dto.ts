import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Generic server-side pagination for Investments/Profits/Documents (mission Part 32/36/43/56 — default 20/page). */
export class FindPortalPageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 20;

  @IsUUID()
  @IsOptional()
  opportunityId?: string;
}
