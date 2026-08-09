import { Injectable, OnModuleInit } from '@nestjs/common';
import { CustomersService } from '../../customers/customers.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
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
    example: 'Acme Trading LLC',
  },
  {
    key: 'commercialName',
    labelKey: 'importCenter.fields.commercialName',
    label: 'Commercial Name',
    required: false,
    type: 'string',
  },
  {
    key: 'phone',
    labelKey: 'importCenter.fields.phone',
    label: 'Phone',
    required: false,
    type: 'string',
    example: '+966501234567',
    uniqueWithinFile: true,
  },
  {
    key: 'mobile',
    labelKey: 'importCenter.fields.mobile',
    label: 'Mobile',
    required: false,
    type: 'string',
  },
  {
    key: 'email',
    labelKey: 'importCenter.fields.email',
    label: 'Email',
    required: false,
    type: 'string',
    example: 'billing@acme.com',
    uniqueWithinFile: true,
  },
  {
    key: 'taxNumber',
    labelKey: 'importCenter.fields.taxNumber',
    label: 'Tax Number',
    required: false,
    type: 'string',
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
    label: 'Address',
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
];

/**
 * Customers Import (TASK-056) — every row calls `CustomersService.create()`
 * unchanged, so the same duplicate-phone/email check, auto-minted
 * `customerNumber`, and every other business rule the manual Customer form
 * enforces applies identically here.
 */
@Injectable()
export class CustomersImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'CUSTOMERS';
  readonly labelKey = 'importCenter.types.customers.label';
  readonly descriptionKey = 'importCenter.types.customers.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly customersService: CustomersService,
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
    if (options?.dryRun) return { id: 'dry-run' };
    const customer = await this.customersService.create(
      {
        name: row.name,
        commercialName: row.commercialName || undefined,
        phone: row.phone || undefined,
        mobile: row.mobile || undefined,
        email: row.email || undefined,
        taxNumber: row.taxNumber || undefined,
        city: row.city || undefined,
        address: row.address || undefined,
        notes: row.notes || undefined,
      },
      userId,
    );
    return { id: customer.id };
  }
}
