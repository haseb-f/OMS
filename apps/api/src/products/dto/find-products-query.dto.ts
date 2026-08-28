import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ProductStatus, ProductType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import {
  TransformEnumList,
  IsOptionalUuidList,
} from '../../common/query/enum-list';

/**
 * Filtering by Category/Brand/Tax/Status/Type; search across SKU/Name/
 * NameEn/Barcode/InternalName/DisplayName/SearchKeywords. Pagination/sort/
 * includeArchived mirror `MasterDataQueryDto`'s shape (TASK-027 — Products
 * gets real server-side pagination, unlike the earlier Suppliers/Leads
 * "return everything" pattern, since it explicitly needs an Enterprise Data
 * Table).
 */
export class FindProductsQueryDto {
  @IsOptionalUuidList()
  categoryId?: string[];

  @IsOptionalUuidList()
  brandId?: string[];

  @IsOptionalUuid()
  taxId?: string;

  @TransformEnumList()
  @IsEnum(ProductStatus, { each: true })
  @IsOptional()
  status?: ProductStatus[];

  @TransformEnumList()
  @IsEnum(ProductType, { each: true })
  @IsOptional()
  type?: ProductType[];

  /** Inventory movement pickers (Transfer/Adjustment/Opening) — only products a movement can legally apply to (ADR-0013). */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  isInventoryItem?: boolean;

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

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  includeArchived?: boolean = false;
}
