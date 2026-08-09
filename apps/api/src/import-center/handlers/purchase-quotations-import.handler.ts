import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PurchaseType } from '@prisma/client';
import { PurchaseQuotationsService } from '../../purchasing/quotations/purchase-quotations.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { ProductsService } from '../../products/products.service';
import { UnitsService } from '../../units/units.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { TaxesService } from '../../taxes/taxes.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import {
  resolveOptionalIdByField,
  resolveRequiredIdByField,
} from '../import-value.util';
import {
  PRODUCT_LINE_FIELDS,
  parseLineQuantity,
  parseLineUnitPrice,
  parseOptionalNumber,
  resolveLineTaxId,
  resolveLineUnitId,
  resolveLineWarehouseId,
  resolveProductBySku,
} from './document-line.util';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'documentNumber',
    labelKey: 'importCenter.fields.documentNumber',
    label: 'Document Number',
    required: true,
    type: 'string',
    example: 'Groups multiple rows into one Quotation',
  },
  {
    key: 'partyName',
    labelKey: 'importCenter.fields.supplierName',
    label: 'Supplier Name',
    required: true,
    type: 'string',
  },
  {
    key: 'purchaseType',
    labelKey: 'importCenter.fields.purchaseType',
    label: 'Purchase Type',
    required: true,
    type: 'string',
    example: 'INVENTORY',
    options: Object.values(PurchaseType),
  },
  {
    key: 'documentDate',
    labelKey: 'importCenter.fields.documentDate',
    label: 'Document Date',
    required: false,
    type: 'date',
  },
  {
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency Code',
    required: false,
    type: 'string',
  },
  {
    key: 'referenceNumber',
    labelKey: 'importCenter.fields.referenceNumber',
    label: 'Reference Number',
    required: false,
    type: 'string',
  },
  PRODUCT_LINE_FIELDS.productSku,
  PRODUCT_LINE_FIELDS.description,
  PRODUCT_LINE_FIELDS.unitName,
  PRODUCT_LINE_FIELDS.quantity,
  PRODUCT_LINE_FIELDS.unitPrice,
  PRODUCT_LINE_FIELDS.discountPercent,
  PRODUCT_LINE_FIELDS.taxName,
];

/** Purchase Quotations Import (TASK-059) — mirrors Sales Quotations exactly, calling `PurchaseQuotationsService.create()`. */
@Injectable()
export class PurchaseQuotationsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'PURCHASE_QUOTATIONS';
  readonly labelKey = 'importCenter.types.purchaseQuotations.label';
  readonly descriptionKey = 'importCenter.types.purchaseQuotations.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'documentNumber';

  constructor(
    private readonly purchaseQuotationsService: PurchaseQuotationsService,
    private readonly suppliersService: SuppliersService,
    private readonly productsService: ProductsService,
    private readonly unitsService: UnitsService,
    private readonly warehousesService: WarehousesService,
    private readonly taxesService: TaxesService,
    private readonly currenciesService: CurrenciesService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    return this.importGroup([row], userId, options);
  }

  async importGroup(
    rows: Record<string, string>[],
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const first = rows[0];
    const purchaseType = first.purchaseType?.trim().toUpperCase();
    if (
      !purchaseType ||
      !Object.values(PurchaseType).includes(purchaseType as PurchaseType)
    ) {
      throw new BadRequestException(
        `Invalid purchase type "${first.purchaseType}" — expected one of ${Object.values(PurchaseType).join(', ')}.`,
      );
    }
    const supplierId = await resolveRequiredIdByField(
      this.suppliersService,
      'name',
      first.partyName,
      'Supplier',
    );
    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      first.currencyCode,
      'Currency Code',
    );

    const items = await Promise.all(
      rows.map(async (row) => {
        const product = await resolveProductBySku(
          this.productsService,
          row.productSku,
        );
        const unitId = await resolveLineUnitId(
          this.unitsService,
          row.unitName,
          product.unitId,
        );
        const warehouseId = await resolveLineWarehouseId(
          this.warehousesService,
          row.warehouseName,
          false,
        );
        const taxId = await resolveLineTaxId(this.taxesService, row.taxName);
        return {
          productId: product.id,
          description: row.description || undefined,
          warehouseId,
          unitId,
          quantity: parseLineQuantity(row.quantity),
          unitPrice: parseLineUnitPrice(row.unitPrice),
          discountPercent: parseOptionalNumber(row.discountPercent),
          taxId,
        };
      }),
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const quotation = await this.purchaseQuotationsService.create({
      supplierId,
      purchaseType: purchaseType as PurchaseType,
      currencyId,
      documentDate: first.documentDate || undefined,
      referenceNumber: first.referenceNumber || undefined,
      items,
    });
    return { id: quotation.id };
  }
}
