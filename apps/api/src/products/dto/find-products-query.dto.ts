import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProductStatus, ProductType } from '@prisma/client';

/** Filtering by Category/Brand/Status/Type; search by SKU/Name/Barcode. */
export class FindProductsQueryDto {
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  brandId?: string;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @IsEnum(ProductType)
  @IsOptional()
  type?: ProductType;

  /**
   * Matches against SKU, Name, Barcode, InternalName, DisplayName, or
   * SearchKeywords (case-insensitive, partial).
   */
  @IsString()
  @IsOptional()
  search?: string;
}
