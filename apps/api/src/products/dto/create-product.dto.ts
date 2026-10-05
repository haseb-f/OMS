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
  ItemType,
  ProductCostingMethod,
  ProductStatus,
  ProductSupplyMethod,
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

  /**
   * Optional since R13 — omitted, the category's default unit is used
   * (ProductsService; 400 when the category has none either).
   */
  @IsOptionalUuid()
  unitId?: string;

  @IsOptionalUuid()
  taxId?: string;

  /** Cost Center — an Analytic Account. */
  @IsOptionalUuid()
  analyticAccountId?: string;

  @IsOptionalUuid()
  preferredPartnerId?: string;

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
   * DEPRECATED (R13) — the stored `type` is derived from itemType / flags /
   * supplyMethod on every write. Accepted only as an input hint for old
   * callers and import files that send nothing else: it is mapped onto the
   * independent attributes (`legacyTypeToAttributes`) and otherwise ignored.
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

  /**
   * Independent attributes (R13). Omitted values default from `itemType`
   * (PRODUCT: sell + buy, tracked; SERVICE: sell only, untracked); explicit
   * values always win, subject to the hard rules in `product-attributes.ts`.
   * Doubles as "Available For Purchase" / "Available For Sale" / "Track Inventory".
   */
  @IsBoolean()
  @IsOptional()
  isPurchasable?: boolean;

  @IsBoolean()
  @IsOptional()
  isSellable?: boolean;

  @IsBoolean()
  @IsOptional()
  isInventoryItem?: boolean;

  /**
   * commission-policy.md A2 — explicit commercial type (PRODUCT / SERVICE),
   * independent of stocking. Omitted on create: inferred from the legacy
   * `type` hint, else PRODUCT.
   */
  @IsEnum(ItemType)
  @IsOptional()
  itemType?: ItemType;

  /**
   * How the item is supplied (R13): PURCHASED, ASSEMBLED (stocked, built by an
   * assembly order from its recipe) or KIT (no stock of its own; sold from
   * components). SERVICE is always PURCHASED.
   */
  @IsEnum(ProductSupplyMethod)
  @IsOptional()
  supplyMethod?: ProductSupplyMethod;

  /**
   * Investor Engine Milestone 4, Part B — explicit opt-in for the Investment Opportunity Product picker. Defaults false.
   * R13: `true` only for company-owned, sellable, ACTIVE, non-service products (422 PRODUCT_INVESTMENT_NOT_ALLOWED).
   */
  @IsBoolean()
  @IsOptional()
  availableForInvestmentOpportunities?: boolean;

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

  /**
   * Agents milestone (spec §4) — owner agent of the goods; null/omitted =
   * company-owned. Settable only while the product has no stock movement
   * and no order line (ProductsService enforces PRODUCT_OWNER_LOCKED).
   */
  @IsOptionalUuid()
  ownerAgentId?: string | null;
}
