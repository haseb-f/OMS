import { Injectable, OnModuleInit } from '@nestjs/common';
import { SalesOrdersService } from '../../sales/orders/sales-orders.service';
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
    example: 'Groups multiple rows into one Order',
  },
  {
    key: 'partyName',
    labelKey: 'importCenter.fields.customerName',
    label: 'Customer Name',
    required: true,
    type: 'string',
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
  { ...PRODUCT_LINE_FIELDS.warehouseName, required: true },
  PRODUCT_LINE_FIELDS.unitName,
  PRODUCT_LINE_FIELDS.quantity,
  PRODUCT_LINE_FIELDS.unitPrice,
  PRODUCT_LINE_FIELDS.discountPercent,
  PRODUCT_LINE_FIELDS.taxName,
];

/**
 * Sales Orders Import (TASK-059) — every group of rows sharing
 * `documentNumber` becomes one `SalesOrdersService.create()` call. Warehouse
 * is required on every line here (unlike Quotation), matching
 * `CreateSalesOrderDto`'s own rule enforced in the service.
 */
@Injectable()
export class SalesOrdersImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'SALES_ORDERS';
  readonly labelKey = 'importCenter.types.salesOrders.label';
  readonly descriptionKey = 'importCenter.types.salesOrders.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'documentNumber';

  constructor(
    private readonly salesOrdersService: SalesOrdersService,
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
        };
      }),
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const order = await this.salesOrdersService.create({
      customerId,
      currencyId,
      referenceNumber: first.referenceNumber || undefined,
      items,
    });
    return { id: order.id };
  }
}
