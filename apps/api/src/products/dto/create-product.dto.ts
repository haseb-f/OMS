import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ProductStatus, ProductType } from '@prisma/client';

/**
 * Flexible model for PHYSICAL / SERVICE / DIGITAL / BUNDLE — bundle
 * composition/logic is not implemented, BUNDLE exists only as a type value.
 * No inventory, cost, price, tax, or ecommerce fields — explicitly excluded.
 */
export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Operational/back-office name. */
  @IsString()
  @IsNotEmpty()
  internalName!: string;

  /** Customer-facing name. */
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  /** SKU must be unique. */
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  searchKeywords?: string;

  /** Required. */
  @IsUUID()
  categoryId!: string;

  @IsUUID()
  @IsOptional()
  brandId?: string;

  /** Required. */
  @IsUUID()
  unitId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  shortDescription?: string;

  @IsString()
  @IsOptional()
  longDescription?: string;

  @IsEnum(ProductType)
  type!: ProductType;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  /** Defaults by type when omitted (see ProductsService); manual override always allowed. */
  @IsBoolean()
  @IsOptional()
  isPurchasable?: boolean;

  @IsBoolean()
  @IsOptional()
  isSellable?: boolean;

  @IsBoolean()
  @IsOptional()
  isInventoryItem?: boolean;

  /** Required by Shipping later — nullable here since SERVICE/DIGITAL products have no physical form.
   * Mandatory when isInventoryItem is true (enforced in ProductsService). */
  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsNumber()
  @IsOptional()
  width?: number;

  @IsNumber()
  @IsOptional()
  height?: number;

  @IsNumber()
  @IsOptional()
  length?: number;
}
