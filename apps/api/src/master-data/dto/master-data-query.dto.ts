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

  /**
   * Capped at 1000, not 200 — several pages use this endpoint to populate a
   * dropdown's full option list (`pageSize: 500`, e.g. Chart of Accounts,
   * Categories' account overrides, Cost Centers), not real pagination. A
   * cap of 200 silently truncated those to a 400 VALIDATION_ERROR that call
   * sites without their own error handling swallowed into an empty
   * dropdown — the exact "dropdown never loads" root cause this system-wide
   * pass was asked to find and fix, not patch with a fake default option.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
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
