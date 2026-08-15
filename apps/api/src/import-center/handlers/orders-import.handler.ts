import { Injectable, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { LeadSource } from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { CountriesService } from '../../countries/countries.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { UsersService } from '../../users/users.service';
import { ProductsService } from '../../products/products.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import {
  resolveOptionalIdByField,
  resolveRequiredIdByField,
} from '../import-value.util';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../../common/phone/phone-number.service';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
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
    key: 'countryName',
    labelKey: 'importCenter.fields.countryName',
    label: 'Country',
    required: true,
    type: 'string',
    referenceType: 'COUNTRY',
    referenceDisplayWithCode: true,
  },
  {
    key: 'mobileNumber',
    labelKey: 'importCenter.fields.mobileNumber',
    label: 'Phone',
    required: true,
    type: 'string',
    example: '+966501234567',
  },
  {
    key: 'city',
    labelKey: 'importCenter.fields.city',
    label: 'City',
    required: false,
    type: 'string',
  },
  {
    key: 'address',
    labelKey: 'importCenter.fields.address',
    label: 'Detailed Address',
    required: true,
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
    referenceMatchField: 'code',
  },
  {
    key: 'quantity',
    labelKey: 'importCenter.fields.quantity',
    label: 'Quantity',
    required: false,
    type: 'number',
    example: '1',
  },
  {
    key: 'paidAmount',
    labelKey: 'importCenter.fields.paidAmount',
    label: 'Paid Amount',
    required: true,
    type: 'number',
  },
  {
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency',
    required: false,
    type: 'string',
    example: 'SAR',
    referenceType: 'CURRENCY',
  },
  {
    key: 'paymentMethodLabel',
    labelKey: 'importCenter.fields.paymentMethodLabel',
    label: 'Payment Method',
    required: false,
    type: 'string',
    referenceType: 'PAYMENT_METHOD',
  },
  {
    key: 'receipt1',
    labelKey: 'importCenter.fields.receipt1',
    label: 'Receipt 1',
    required: false,
    type: 'string',
  },
  {
    key: 'receipt2',
    labelKey: 'importCenter.fields.receipt2',
    label: 'Receipt 2',
    required: false,
    type: 'string',
  },
  {
    key: 'receipt3',
    labelKey: 'importCenter.fields.receipt3',
    label: 'Receipt 3',
    required: false,
    type: 'string',
  },
  {
    key: 'notes',
    labelKey: 'importCenter.fields.notes',
    label: 'Notes',
    required: false,
    type: 'string',
  },
  {
    key: 'agentEmail',
    labelKey: 'importCenter.fields.agentEmail',
    label: 'Employee',
    required: false,
    type: 'string',
    referenceType: 'EMPLOYEE',
    referenceMatchField: 'code',
  },
];

/**
 * Orders Import (TASK-061 follow-up, Part 6) — a complete order: address,
 * product, and paid amount are all required, matching the manual Lead/Order
 * dialog's Order-mode minimum (Part 1). Split from Leads (see
 * `leads-import.handler.ts`) precisely because the two need different
 * minimum-field rules on the same underlying `Lead` table.
 *
 * `externalOrderId` is the primary duplicate key (required + unique-within-
 * file here; `LeadsService.create()` itself also rejects a re-imported
 * duplicate by this field — this handler never re-implements that check,
 * only surfaces the dry-run's per-row uniqueness pass early). Calls
 * `LeadsService.create()` with `recordType: 'ORDER'`, so a real linked
 * `Payment` is created in the same transaction — never the old
 * metadata-only side record a plain Lead import used before this split;
 * `Payment Method`/receipts/notes still have no dedicated column, so those
 * alone are logged via `recordImportedOrderDetails` for the audit trail.
 */
@Injectable()
export class OrdersImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'ORDERS';
  readonly labelKey = 'importCenter.types.orders.label';
  readonly descriptionKey = 'importCenter.types.orders.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly leadsService: LeadsService,
    private readonly countriesService: CountriesService,
    private readonly currenciesService: CurrenciesService,
    private readonly usersService: UsersService,
    private readonly productsService: ProductsService,
    private readonly registry: ImportTypeRegistryService,
    private readonly phoneNumberService: PhoneNumberService,
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
    if (!row.externalOrderId?.trim()) {
      throw new BadRequestException('External Order ID is required.');
    }

    const quantity = row.quantity ? Number(row.quantity) : undefined;
    if (row.quantity && (!Number.isInteger(quantity) || (quantity ?? 0) < 1)) {
      throw new BadRequestException(
        'Quantity must be a whole number of at least 1.',
      );
    }

    const paidAmount = Number(row.paidAmount);
    if (!row.paidAmount || Number.isNaN(paidAmount) || paidAmount < 0) {
      throw new BadRequestException(
        'Paid Amount must be a non-negative number.',
      );
    }

    const countryId = await resolveRequiredIdByField(
      this.countriesService,
      'name',
      row.countryName,
      'Country',
    );
    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      row.currencyCode,
      'Currency',
    );
    const productId = await resolveRequiredIdByField(
      this.productsService,
      'sku',
      row.productSku,
      'Product',
    );
    const salesEmployeeId = await this.resolveAgent(row.agentEmail);
    // Validates the label against real Payment Method master data (spec
    // section 9) — still stored as free text via
    // `recordImportedOrderDetails` below since `Lead` has no dedicated FK
    // column for it, same "no dedicated column yet" scoping as Receipts/
    // Notes on this same call.
    await this.referenceData.resolveOptional(
      'PAYMENT_METHOD',
      'name',
      row.paymentMethodLabel,
      'Payment Method',
    );

    // Validated here too (not just inside LeadsService.create()) so the
    // dry-run validation pass — which returns before create() is ever
    // called — actually catches a bad phone number instead of silently
    // deferring it to the real import pass.
    const country = await this.countriesService.findOne(countryId);
    const phoneCheck = this.phoneNumberService.parse(
      row.mobileNumber,
      country.code,
    );
    if (!phoneCheck.isValid) {
      throw new BadRequestException(phoneErrorMessage(phoneCheck.errorReason));
    }

    if (options?.dryRun) return { id: 'dry-run' };

    const lead = await this.leadsService.create(
      {
        recordType: 'ORDER',
        customerName: row.customerName,
        mobileNumber: row.mobileNumber,
        countryId,
        city: row.city || undefined,
        address: row.address,
        productId,
        quantity,
        currencyId,
        paidAmount,
        source: LeadSource.EXCEL,
        salesEmployeeId,
        externalOrderId: row.externalOrderId,
        importBatch: `import-center-${new Date().toISOString().slice(0, 10)}`,
      },
      userId,
    );

    await this.leadsService.recordImportedOrderDetails(lead.id, {
      orderDate: row.orderDate || undefined,
      paymentMethodLabel: row.paymentMethodLabel || undefined,
      receiptUrls: [row.receipt1, row.receipt2, row.receipt3].filter(
        (url): url is string => !!url,
      ),
      notes: row.notes || undefined,
    });

    return { id: lead.id };
  }

  private async resolveAgent(
    email: string | undefined,
  ): Promise<string | undefined> {
    const trimmed = email?.trim();
    if (!trimmed) return undefined;
    const users = await this.usersService.findAll();
    const match = users.find(
      (user) => user.email.toLowerCase() === trimmed.toLowerCase(),
    );
    if (!match) {
      throw new BadRequestException(`Agent "${trimmed}" not found.`);
    }
    return match.id;
  }
}
