import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { StoreOrderSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomersService } from '../../customers/customers.service';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import {
  ImportRowNeedsReviewError,
  type ImportFieldDef,
  type ImportRowOptions,
  type ImportRowResult,
  type ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'externalOrderId',
    labelKey: 'importCenter.fields.externalOrderId',
    label: 'External Order ID',
    required: true,
    type: 'string',
    example: 'SH-100234',
    uniqueWithinFile: true,
  },
  {
    key: 'orderDate',
    labelKey: 'importCenter.fields.orderDate',
    label: 'Order Date',
    required: false,
    type: 'date',
    example: '2026-08-01',
  },
  {
    key: 'customerName',
    labelKey: 'importCenter.fields.name',
    label: 'Customer Name',
    required: true,
    type: 'string',
    example: 'Mohammed Al-Otaibi',
  },
  {
    key: 'customerPhone',
    labelKey: 'importCenter.fields.mobileNumber',
    label: 'Customer Phone',
    required: true,
    type: 'string',
    example: '+966501234567',
  },
  {
    key: 'customerEmail',
    labelKey: 'importCenter.fields.email',
    label: 'Customer Email',
    required: false,
    type: 'string',
  },
  {
    key: 'productSku',
    labelKey: 'importCenter.fields.productSku',
    label: 'Product (SKU)',
    required: true,
    type: 'string',
    example: 'PRD-000123',
    referenceType: 'PRODUCT',
  },
  {
    key: 'quantity',
    labelKey: 'importCenter.fields.quantity',
    label: 'Quantity',
    required: true,
    type: 'number',
    example: '1',
  },
  {
    key: 'unitPrice',
    labelKey: 'importCenter.fields.unitPrice',
    label: 'Unit Price',
    required: true,
    type: 'number',
    example: '99.00',
  },
  {
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency',
    required: true,
    type: 'string',
    example: 'SAR',
    referenceType: 'CURRENCY',
  },
  {
    key: 'sourceChannel',
    labelKey: 'importCenter.fields.sourceChannel',
    label: 'Source Channel',
    required: false,
    type: 'string',
    example: 'Salla',
  },
];

/**
 * Store Orders Import (Store Orders + Shipping Operations) — one row per
 * order line (same "one row = one order + one product line" minimum shape
 * `orders-import.handler.ts` already established for the legacy Lead/Order
 * pipeline; this handler is otherwise completely independent of it).
 *
 * `externalOrderId` is the primary dedup key (rule 1): a repeat is rejected
 * outright, naming the existing `internalOrderId` — this is a plain
 * validation error, not a needs-review outcome, since it's unambiguous.
 *
 * Phone matching (rule 2) is the one genuinely ambiguous case: when
 * `CustomersService.lookupByPhone` already finds an existing Customer, this
 * handler NEVER silently attaches to it during the automated pass —
 * instead it throws `ImportRowNeedsReviewError` so the row surfaces on the
 * Import Center's Needs Review screen, and only actually creates anything
 * once a human calls the Confirm operation (`resolveNeedsReview`, wired to
 * `POST /import-center/jobs/:jobId/rows/:rowId/confirm`). A row with NO
 * existing phone match imports automatically as new Customer + new Store
 * Order via `StoreOrdersService.create` (which itself calls
 * `CustomersService.findOrCreate` — never a second matching mechanism).
 */
@Injectable()
export class StoreOrdersImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'STORE_ORDERS';
  readonly labelKey = 'importCenter.types.storeOrders.label';
  readonly descriptionKey = 'importCenter.types.storeOrders.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly storeOrdersService: StoreOrdersService,
    private readonly registry: ImportTypeRegistryService,
    private readonly referenceData: ReferenceDataRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const { currencyId, productId, quantity, unitPrice } =
      await this.validateRow(row);

    if (!row.customerPhone?.trim()) {
      throw new BadRequestException('Customer Phone is required.');
    }
    const existingCustomer = await this.customersService.lookupByPhone(
      row.customerPhone,
    );
    if (existingCustomer) {
      throw new ImportRowNeedsReviewError(
        `Existing customer found by phone (${existingCustomer.customerNumber} — ${existingCustomer.name}) — confirm to attach.`,
      );
    }

    if (options?.dryRun) return { id: 'dry-run' };

    const order = await this.storeOrdersService.create(
      this.buildDto(row, currencyId, productId, quantity, unitPrice),
      userId,
    );
    return { id: order.id };
  }

  /** Called only after a human confirms a needs-review row — never re-checks the phone match, always writes for real. */
  async resolveNeedsReview(
    row: Record<string, string>,
    userId?: string,
  ): Promise<ImportRowResult> {
    const { currencyId, productId, quantity, unitPrice } =
      await this.validateRow(row);
    const order = await this.storeOrdersService.create(
      this.buildDto(row, currencyId, productId, quantity, unitPrice),
      userId,
    );
    return { id: order.id };
  }

  private buildDto(
    row: Record<string, string>,
    currencyId: string,
    productId: string,
    quantity: number,
    unitPrice: number,
  ) {
    return {
      externalOrderId: row.externalOrderId,
      customer: {
        name: row.customerName,
        phone: row.customerPhone,
        email: row.customerEmail || undefined,
      },
      orderDate: row.orderDate || undefined,
      source: StoreOrderSource.IMPORT,
      sourceChannel: row.sourceChannel || undefined,
      currencyId,
      items: [{ productId, quantity, unitPrice }],
    };
  }

  private async validateRow(row: Record<string, string>) {
    if (!row.externalOrderId?.trim()) {
      throw new BadRequestException('External Order ID is required.');
    }
    const existingOrder = await this.prisma.storeOrder.findFirst({
      where: { externalOrderId: row.externalOrderId, deletedAt: null },
    });
    if (existingOrder) {
      throw new BadRequestException({
        code: 'DUPLICATE',
        message: `A Store Order with external order id "${row.externalOrderId}" already exists (${existingOrder.internalOrderId}).`,
        fields: [{ field: 'externalOrderId', constraints: ['unique'] }],
      });
    }

    const quantity = Number(row.quantity);
    if (!row.quantity || !Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException(
        'Quantity must be a whole number of at least 1.',
      );
    }
    const unitPrice = Number(row.unitPrice);
    if (!row.unitPrice || Number.isNaN(unitPrice) || unitPrice < 0) {
      throw new BadRequestException(
        'Unit Price must be a non-negative number.',
      );
    }

    const currencyId = await this.referenceData.resolveRequired(
      'CURRENCY',
      'code',
      row.currencyCode,
      'Currency',
    );
    const productId = await this.referenceData.resolveRequired(
      'PRODUCT',
      'code',
      row.productSku,
      'Product',
    );

    return { currencyId, productId, quantity, unitPrice };
  }
}
