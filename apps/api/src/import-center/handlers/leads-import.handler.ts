import { Injectable, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { LeadSource } from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { CountriesService } from '../../countries/countries.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { UsersService } from '../../users/users.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { resolveRequiredIdByField } from '../import-value.util';
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
    required: false,
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
  },
  {
    key: 'city',
    labelKey: 'importCenter.fields.city',
    label: 'City',
    required: true,
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
    key: 'mobileNumber',
    labelKey: 'importCenter.fields.mobileNumber',
    label: 'Phone',
    required: true,
    type: 'string',
    example: '+966501234567',
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
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency',
    required: true,
    type: 'string',
    example: 'SAR',
  },
  {
    key: 'paidAmount',
    labelKey: 'importCenter.fields.paidAmount',
    label: 'Paid Amount',
    required: false,
    type: 'number',
  },
  {
    key: 'paymentMethodLabel',
    labelKey: 'importCenter.fields.paymentMethodLabel',
    label: 'Payment Method',
    required: false,
    type: 'string',
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
  },
];

/**
 * Leads/Orders Import (TASK-061) — every row calls `LeadsService.create()`
 * unchanged, so Duplicate Lead detection, Customer Master matching/linking
 * (never duplicates a Customer by phone), Duplicate Order detection (by
 * `externalOrderId`), and Auto Assignment for any row left unassigned all
 * apply identically to an imported row as to a manually-created Lead/Order
 * — nothing here re-implements any of that. "Employee" resolves
 * `agentEmail` to `salesEmployeeId`, preserving an explicit import-file
 * assignment over Auto Assignment (same as before this task).
 */
@Injectable()
export class LeadsImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'LEADS';
  readonly labelKey = 'importCenter.types.leads.label';
  readonly descriptionKey = 'importCenter.types.leads.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly leadsService: LeadsService,
    private readonly countriesService: CountriesService,
    private readonly currenciesService: CurrenciesService,
    private readonly usersService: UsersService,
    private readonly registry: ImportTypeRegistryService,
    private readonly phoneNumberService: PhoneNumberService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const quantity = Number(row.quantity);
    if (!row.quantity || !Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException(
        'Quantity must be a whole number of at least 1.',
      );
    }

    const paidAmount = row.paidAmount ? Number(row.paidAmount) : undefined;
    if (row.paidAmount && (Number.isNaN(paidAmount) || (paidAmount ?? 0) < 0)) {
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
    const currencyId = await resolveRequiredIdByField(
      this.currenciesService,
      'code',
      row.currencyCode,
      'Currency',
    );
    const salesEmployeeId = await this.resolveAgent(row.agentEmail);

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
        customerName: row.customerName,
        mobileNumber: row.mobileNumber,
        countryId,
        city: row.city,
        address: row.address,
        quantity,
        currencyId,
        source: LeadSource.EXCEL,
        salesEmployeeId,
        externalOrderId: row.externalOrderId || undefined,
        importBatch: `import-center-${new Date().toISOString().slice(0, 10)}`,
      },
      userId,
    );

    await this.leadsService.recordImportedOrderDetails(lead.id, {
      orderDate: row.orderDate || undefined,
      paidAmount,
      currencyCode: row.currencyCode || undefined,
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
