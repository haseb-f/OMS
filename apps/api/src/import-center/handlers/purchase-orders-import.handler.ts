import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PurchaseType } from '@prisma/client';
import { PurchaseOrdersService } from '../../purchase-orders/purchase-orders.service';
import { PartnersService } from '../../partners/partners.service';
import { ProductsService } from '../../products/products.service';
import { UnitsService } from '../../units/units.service';
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
    labelKey: 'importCenter.fields.supplierName',
    label: 'Supplier Name',
    required: true,
    type: 'string',
    referenceType: 'SUPPLIER',
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
  PRODUCT_LINE_FIELDS.unitName,
  PRODUCT_LINE_FIELDS.quantity,
  PRODUCT_LINE_FIELDS.unitPrice,
  PRODUCT_LINE_FIELDS.discountPercent,
  PRODUCT_LINE_FIELDS.taxName,
];

/**
 * Purchase Orders Import (TASK-059) — "a Purchase Order is only an agreement
 * to buy": no Receiving Warehouse on the line (`PurchaseOrderItemInputDto`
 * has none), and `subtotal` is computed here exactly like the manual editor
 * does before `PurchaseOrdersService.create()` — never a Posting Engine or
 * inventory concern.
 */
@Injectable()
export class PurchaseOrdersImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'PURCHASE_ORDERS';
  readonly labelKey = 'importCenter.types.purchaseOrders.label';
  readonly descriptionKey = 'importCenter.types.purchaseOrders.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'documentNumber';

  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly partnersService: PartnersService,
    private readonly productsService: ProductsService,
    private readonly unitsService: UnitsService,
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
    const partnerId = await resolveRequiredIdByField(
      this.partnersService,
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
        const taxId = await resolveLineTaxId(this.taxesService, row.taxName);
        const quantity = parseLineQuantity(row.quantity);
        const unitPrice = parseLineUnitPrice(row.unitPrice);
        const discountPercent = parseOptionalNumber(row.discountPercent) ?? 0;
        const subtotal =
          Math.round(quantity * unitPrice * (1 - discountPercent / 100) * 100) /
          100;
        return {
          productId: product.id,
          description: row.description || undefined,
          unitId,
          quantity,
          unitPrice,
          discountPercent,
          subtotal,
          taxId,
        };
      }),
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const order = await this.purchaseOrdersService.create({
      partnerId,
      purchaseType: purchaseType as PurchaseType,
      currencyId,
      referenceNumber: first.referenceNumber || undefined,
      items,
    });
    return { id: order.id };
  }
}
