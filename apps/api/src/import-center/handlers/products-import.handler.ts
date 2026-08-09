import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import { ProductsService } from '../../products/products.service';
import { ProductCategoriesService } from '../../product-categories/product-categories.service';
import { UnitsService } from '../../units/units.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { resolveRequiredIdByField } from '../import-value.util';
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
    key: 'type',
    labelKey: 'importCenter.fields.productType',
    label: 'Product Type',
    required: true,
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
  },
  {
    key: 'unitName',
    labelKey: 'importCenter.fields.unitName',
    label: 'Unit',
    required: true,
    type: 'string',
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
 * unchanged (SKU minting, ADR-0012 defaults-by-type, all included).
 * `categoryName`/`unitName` are the only read-only lookups this handler
 * does itself — resolving a human-readable name to the id
 * `CreateProductDto` actually requires, never a write.
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
    const type = row.type?.trim().toUpperCase();
    if (!type || !Object.values(ProductType).includes(type as ProductType)) {
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
    const unitId = await resolveRequiredIdByField(
      this.unitsService,
      'name',
      row.unitName,
      'Unit',
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const product = await this.productsService.create(
      {
        name: row.name,
        type: type as ProductType,
        categoryId,
        unitId,
        barcode: row.barcode || undefined,
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
