import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  ProductCostingMethod,
  ProductStatus,
  ProductType,
} from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * Enterprise Products (TASK-027) — STOCKABLE / SERVICE / CONSUMABLE. `sku`
 * is never supplied by the client: ProductsService mints it via the
 * Numbering Engine's PRODUCT series before the row is created.
 */
export class CreateProductDto {
  /** Arabic name — primary identity, required. */
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** English name — optional. */
  @IsString()
  @IsOptional()
  nameEn?: string;

  /** Operational/back-office name — defaults to `name` when omitted (TASK-028: not asked at creation). */
  @IsString()
  @IsOptional()
  internalName?: string;

  /** Customer-facing name — defaults to `name` when omitted (TASK-028: not asked at creation). */
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  qrCodeValue?: string;

  @IsString()
  @IsOptional()
  searchKeywords?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  /** Required. */
  @IsUUID()
  categoryId!: string;

  @IsOptionalUuid()
  brandId?: string;

  /** Required. */
  @IsUUID()
  unitId!: string;

  @IsOptionalUuid()
  taxId?: string;

  /** Cost Center — an Analytic Account. */
  @IsOptionalUuid()
  analyticAccountId?: string;

  @IsOptionalUuid()
  preferredSupplierId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  shortDescription?: string;

  @IsString()
  @IsOptional()
  longDescription?: string;

  /**
   * Optional — never a mandatory extra step in the creation wizard.
   * Defaults to `PURCHASE_AND_SALE` in `ProductsService.create()` when
   * omitted (the safest default: sellable AND purchasable), still editable
   * later like every other field.
   */
  @IsEnum(ProductType)
  @IsOptional()
  type?: ProductType;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  /** Defaults by type when omitted (see ProductsService); manual override always allowed.
   * Doubles as "Available For Purchase" / "Available For Sale" / "Track Inventory". */
  @IsBoolean()
  @IsOptional()
  isPurchasable?: boolean;

  @IsBoolean()
  @IsOptional()
  isSellable?: boolean;

  @IsBoolean()
  @IsOptional()
  isInventoryItem?: boolean;

  // --- Sales ---------------------------------------------------------
  @IsNumber()
  @IsOptional()
  salesPrice?: number;

  @IsBoolean()
  @IsOptional()
  salesTaxIncluded?: boolean;

  @IsString()
  @IsOptional()
  salesDescription?: string;

  @IsBoolean()
  @IsOptional()
  allowDiscount?: boolean;

  // --- Purchasing ------------------------------------------------------
  @IsNumber()
  @IsOptional()
  purchasePrice?: number;

  @IsString()
  @IsOptional()
  purchaseDescription?: string;

  // --- Inventory -------------------------------------------------------
  @IsNumber()
  @IsOptional()
  reorderLevel?: number;

  @IsNumber()
  @IsOptional()
  reorderQuantity?: number;

  @IsNumber()
  @IsOptional()
  safetyStock?: number;

  @IsOptionalUuid()
  preferredWarehouseId?: string;

  @IsEnum(ProductCostingMethod)
  @IsOptional()
  costingMethod?: ProductCostingMethod;

  @IsNumber()
  @IsOptional()
  minQuantity?: number;

  @IsNumber()
  @IsOptional()
  maxQuantity?: number;

  @IsString()
  @IsOptional()
  storageLocation?: string;

  @IsBoolean()
  @IsOptional()
  serialNumberTracking?: boolean;

  @IsBoolean()
  @IsOptional()
  batchTracking?: boolean;

  /** Required by Shipping later — nullable since SERVICE/CONSUMABLE products have no physical form.
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
