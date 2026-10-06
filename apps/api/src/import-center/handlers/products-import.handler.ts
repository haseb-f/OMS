import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ItemType, ProductType } from '@prisma/client';
import { ProductsService } from '../../products/products.service';
import { ProductCategoriesService } from '../../product-categories/product-categories.service';
import { UnitsService } from '../../units/units.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import {
  parseBoolean,
  resolveOptionalIdByField,
  resolveRequiredIdByField,
} from '../import-value.util';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'name',
    labelKey: 'importCenter.fields.name',
    label: 'Name',
    required: true,
    type: 'string',
    example: 'A4 Paper Ream',
  },
  {
    key: 'itemType',
    labelKey: 'importCenter.fields.productItemType',
    label: 'Item Type',
    required: false,
    type: 'string',
    example: 'PRODUCT',
    options: Object.values(ItemType),
  },
  {
    key: 'isSellable',
    labelKey: 'importCenter.fields.productIsSellable',
    label: 'Sellable',
    required: false,
    type: 'boolean',
    example: 'yes',
  },
  {
    key: 'isPurchasable',
    labelKey: 'importCenter.fields.productIsPurchasable',
    label: 'Purchasable',
    required: false,
    type: 'boolean',
    example: 'yes',
  },
  {
    key: 'isInventoryItem',
    labelKey: 'importCenter.fields.productIsInventoryItem',
    label: 'Track Stock',
    required: false,
    type: 'boolean',
    example: 'yes',
  },
  {
    // Deprecated (R13): kept so existing files keep importing. Only read when
    // no item type / sell / buy / track-stock column is filled in the row.
    key: 'type',
    labelKey: 'importCenter.fields.productType',
    label: 'Product Type (legacy)',
    required: false,
    type: 'string',
    example: 'PURCHASE_AND_SALE',
    options: Object.values(ProductType),
  },
  {
    key: 'categoryName',
    labelKey: 'importCenter.fields.categoryName',
    label: 'Category',
    required: true,
    type: 'string',
    referenceType: 'CATEGORY',
  },
  {
    key: 'unitName',
    labelKey: 'importCenter.fields.unitName',
    label: 'Unit',
    required: false,
    type: 'string',
    referenceType: 'UNIT',
  },
  {
    key: 'barcode',
    labelKey: 'importCenter.fields.barcode',
    label: 'Barcode',
    required: false,
    type: 'string',
  },
  {
    key: 'salesPrice',
    labelKey: 'importCenter.fields.salesPrice',
    label: 'Sales Price',
    required: false,
    type: 'number',
  },
  {
    key: 'purchasePrice',
    labelKey: 'importCenter.fields.purchasePrice',
    label: 'Purchase Price',
    required: false,
    type: 'number',
  },
  {
    key: 'description',
    labelKey: 'importCenter.fields.description',
    label: 'Description',
    required: false,
    type: 'string',
  },
];

/**
 * Products Import (TASK-056) — every row calls `ProductsService.create()`
 * unchanged (SKU minting, itemType-driven defaults, attribute rules, barcode
 * uniqueness, all included). `categoryName`/`unitName` are the only read-only
 * lookups this handler does itself — resolving a human-readable name to the
 * id `CreateProductDto` actually requires, never a write. A blank Unit falls
 * back to the category's default unit inside `create()`.
 */
@Injectable()
export class ProductsImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'PRODUCTS';
  readonly labelKey = 'importCenter.types.products.label';
  readonly descriptionKey = 'importCenter.types.products.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly productsService: ProductsService,
    private readonly categoriesService: ProductCategoriesService,
    private readonly unitsService: UnitsService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const itemType = row.itemType?.trim().toUpperCase();
    if (itemType && !Object.values(ItemType).includes(itemType as ItemType)) {
      throw new BadRequestException(
        `Invalid item type "${row.itemType}" — expected one of ${Object.values(ItemType).join(', ')}.`,
      );
    }
    const type = row.type?.trim().toUpperCase();
    if (type && !Object.values(ProductType).includes(type as ProductType)) {
      throw new BadRequestException(
        `Invalid product type "${row.type}" — expected one of ${Object.values(ProductType).join(', ')}.`,
      );
    }

    const categoryId = await resolveRequiredIdByField(
      this.categoriesService,
      'name',
      row.categoryName,
      'Category',
    );
    const unitId = await resolveOptionalIdByField(
      this.unitsService,
      'name',
      row.unitName,
      'Unit',
    );
    const barcode = row.barcode?.trim();

    // The same uniqueness check create() performs, so a duplicate shows in the preview as a row error.
    if (options?.dryRun) {
      if (barcode) await this.productsService.assertBarcodeAvailable(barcode);
      return { id: 'dry-run' };
    }

    const product = await this.productsService.create(
      {
        name: row.name,
        // Legacy hint only; create() derives the stored type from the attributes.
        type: type ? (type as ProductType) : undefined,
        itemType: itemType ? (itemType as ItemType) : undefined,
        isSellable: parseBoolean(row.isSellable),
        isPurchasable: parseBoolean(row.isPurchasable),
        isInventoryItem: parseBoolean(row.isInventoryItem),
        categoryId,
        unitId,
        barcode: barcode || undefined,
        salesPrice: row.salesPrice ? Number(row.salesPrice) : undefined,
        purchasePrice: row.purchasePrice
          ? Number(row.purchasePrice)
          : undefined,
        description: row.description || undefined,
      },
      userId,
    );
    return { id: product.id };
  }
}
