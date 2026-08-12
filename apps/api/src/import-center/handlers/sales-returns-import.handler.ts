import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { SalesReturnsService } from '../../sales/returns/sales-returns.service';
import { SalesInvoicesService } from '../../sales/invoices/sales-invoices.service';
import { CustomersService } from '../../customers/customers.service';
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
    labelKey: 'importCenter.fields.customerName',
    label: 'Customer Name',
    required: true,
    type: 'string',
    referenceType: 'CUSTOMER',
  },
  {
    key: 'invoiceNumber',
    labelKey: 'importCenter.fields.invoiceNumber',
    label: 'Invoice Number',
    required: true,
    type: 'string',
    example: 'The original Sales Invoice this return applies to',
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
 * Sales Returns Import (TASK-059) — a return can never be standalone: every
 * group must reference a real Sales Invoice (`invoiceNumber`), and each
 * line's Product SKU is matched against that invoice's own lines to resolve
 * `salesInvoiceItemId` — the same field `SalesReturnsService.create()`
 * requires and caps returned quantity against.
 */
@Injectable()
export class SalesReturnsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'SALES_RETURNS';
  readonly labelKey = 'importCenter.types.salesReturns.label';
  readonly descriptionKey = 'importCenter.types.salesReturns.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'documentNumber';

  constructor(
    private readonly salesReturnsService: SalesReturnsService,
    private readonly salesInvoicesService: SalesInvoicesService,
    private readonly customersService: CustomersService,
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
    const customerId = await resolveRequiredIdByField(
      this.customersService,
      'name',
      first.partyName,
      'Customer',
    );
    const salesInvoiceId = await resolveRequiredIdByField(
      this.salesInvoicesService,
      'invoiceNumber',
      first.invoiceNumber,
      'Sales Invoice',
    );
    const invoice = await this.salesInvoicesService.findOne(salesInvoiceId);
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
            `Product "${row.productSku}" was not found on Sales Invoice ${invoice.invoiceNumber}.`,
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
          salesInvoiceItemId: invoiceItem.id,
        };
      }),
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const salesReturn = await this.salesReturnsService.create({
      customerId,
      salesInvoiceId,
      currencyId,
      referenceNumber: first.referenceNumber || undefined,
      items,
    });
    return { id: salesReturn.id };
  }
}
