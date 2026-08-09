import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Shared "Search" query shape for every Master Data list endpoint (Companies,
 * Branches, Warehouses, ...): free-text search across each entity's own
 * declared search fields, pagination, sorting, and an archived-rows toggle.
 * One DTO for all 16 modules — the per-entity difference is only which
 * fields `searchFields` names, not the query shape itself.
 */
export class MasterDataQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

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

  @IsString()
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'asc';

  /**
   * Archived rows (deletedAt set) are excluded from every list by default.
   * Transformed explicitly (not `@Type(() => Boolean)`) since
   * `Boolean('false')` is `true` — the query string must be parsed, not cast.
   */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  includeArchived?: boolean = false;
}
