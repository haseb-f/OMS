import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PurchaseReturnsService } from '../../purchasing/returns/purchase-returns.service';
import { PurchaseInvoicesService } from '../../purchasing/invoices/purchase-invoices.service';
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
    example: 'Groups multiple rows into one Return',
  },
  {
    key: 'partyName',
    labelKey: 'importCenter.fields.supplierName',
    label: 'Supplier Name',
    required: true,
    type: 'string',
    referenceType: 'SUPPLIER',
  },
  {
    key: 'invoiceNumber',
    labelKey: 'importCenter.fields.invoiceNumber',
    label: 'Invoice Number',
    required: true,
    type: 'string',
    example: 'The original Purchase Invoice this return applies to',
  },
  {
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency Code',
    required: false,
    type: 'string',
    referenceType: 'CURRENCY',
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
  { ...PRODUCT_LINE_FIELDS.warehouseName, required: true },
  PRODUCT_LINE_FIELDS.unitName,
  PRODUCT_LINE_FIELDS.quantity,
  PRODUCT_LINE_FIELDS.unitPrice,
  PRODUCT_LINE_FIELDS.discountPercent,
  PRODUCT_LINE_FIELDS.taxName,
];

/**
 * Purchase Returns Import (TASK-059) — mirrors Sales Returns exactly: every
 * group must reference a real Purchase Invoice (`invoiceNumber`), and each
 * line's Product SKU is matched against that invoice's lines to resolve
 * `purchaseInvoiceItemId`.
 */
@Injectable()
export class PurchaseReturnsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'PURCHASE_RETURNS';
  readonly labelKey = 'importCenter.types.purchaseReturns.label';
  readonly descriptionKey = 'importCenter.types.purchaseReturns.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'documentNumber';

  constructor(
    private readonly purchaseReturnsService: PurchaseReturnsService,
    private readonly purchaseInvoicesService: PurchaseInvoicesService,
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
    const supplierId = await resolveRequiredIdByField(
      this.suppliersService,
      'name',
      first.partyName,
      'Supplier',
    );
    const purchaseInvoiceId = await resolveRequiredIdByField(
      this.purchaseInvoicesService,
      'invoiceNumber',
      first.invoiceNumber,
      'Purchase Invoice',
    );
    const invoice =
      await this.purchaseInvoicesService.findOne(purchaseInvoiceId);
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
        const invoiceItem = invoice.items.find(
          (item) => item.productId === product.id,
        );
        if (!invoiceItem) {
          throw new BadRequestException(
            `Product "${row.productSku}" was not found on Purchase Invoice ${invoice.invoiceNumber}.`,
          );
        }
        const unitId = await resolveLineUnitId(
          this.unitsService,
          row.unitName,
          product.unitId,
        );
        const warehouseId = await resolveLineWarehouseId(
          this.warehousesService,
          row.warehouseName,
          true,
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
          purchaseInvoiceItemId: invoiceItem.id,
        };
      }),
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const purchaseReturn = await this.purchaseReturnsService.create({
      supplierId,
      purchaseInvoiceId,
      currencyId,
      referenceNumber: first.referenceNumber || undefined,
      items,
    });
    return { id: purchaseReturn.id };
  }
}
