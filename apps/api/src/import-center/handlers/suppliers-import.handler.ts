import { Injectable, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { CountriesService } from '../../countries/countries.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { resolveOptionalIdByField } from '../import-value.util';
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
    key: 'name',
    labelKey: 'importCenter.fields.name',
    label: 'Name',
    required: true,
    type: 'string',
    example: 'Gulf Supplies Co.',
  },
  {
    key: 'commercialName',
    labelKey: 'importCenter.fields.commercialName',
    label: 'Commercial Name',
    required: false,
    type: 'string',
  },
  {
    key: 'countryName',
    labelKey: 'importCenter.fields.countryName',
    label: 'Country',
    required: false,
    type: 'string',
  },
  {
    key: 'phone',
    labelKey: 'importCenter.fields.phone',
    label: 'Phone',
    required: false,
    type: 'string',
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

/** Suppliers Import (TASK-056) — every row calls `SuppliersService.create()` unchanged (unique supplier code check included). */
@Injectable()
export class SuppliersImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'SUPPLIERS';
  readonly labelKey = 'importCenter.types.suppliers.label';
  readonly descriptionKey = 'importCenter.types.suppliers.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly countriesService: CountriesService,
    private readonly registry: ImportTypeRegistryService,
    private readonly phoneNumberService: PhoneNumberService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    _userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const countryId = await resolveOptionalIdByField(
      this.countriesService,
      'name',
      row.countryName,
      'Country',
    );
    const countryCode = countryId
      ? (await this.countriesService.findOne(countryId)).code
      : undefined;
    for (const value of [row.phone, row.mobile]) {
      if (!value) continue;
      const check = this.phoneNumberService.parse(value, countryCode);
      if (countryCode && !check.isValid) {
        throw new BadRequestException(phoneErrorMessage(check.errorReason));
      }
    }

    if (options?.dryRun) return { id: 'dry-run' };
    const supplier = await this.suppliersService.create({
      name: row.name,
      commercialName: row.commercialName || undefined,
      countryId,
      phone: row.phone || undefined,
      mobile: row.mobile || undefined,
      email: row.email || undefined,
      taxNumber: row.taxNumber || undefined,
      city: row.city || undefined,
      address: row.address || undefined,
      notes: row.notes || undefined,
    });
    return { id: supplier.id };
  }
}
