import { Injectable, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { PartnerRoleType } from '@prisma/client';
import { PartnersService } from '../../partners/partners.service';
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
    key: 'countryName',
    labelKey: 'importCenter.fields.countryName',
    label: 'Country',
    required: false,
    type: 'string',
    referenceType: 'COUNTRY',
    referenceDisplayWithCode: true,
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
 * Customers Import (TASK-056) — every row calls `PartnersService.create()`
 * with the CUSTOMER role (spec section 9: Customers are a role view over
 * Partner, never a separate registry), so the same duplicate-phone/email
 * check, auto-minted `partnerNumber`, and every other business rule the
 * manual Partner form enforces applies identically here.
 */
@Injectable()
export class CustomersImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'CUSTOMERS';
  readonly labelKey = 'importCenter.types.customers.label';
  readonly descriptionKey = 'importCenter.types.customers.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly partnersService: PartnersService,
    private readonly countriesService: CountriesService,
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
    const countryId = await resolveOptionalIdByField(
      this.countriesService,
      'name',
      row.countryName,
      'Country',
    );
    // Country is optional on Customer, but validate strictly whenever the
    // file did supply one — same rule CustomersService.create() enforces,
    // checked here too so the dry-run preview catches it before import.
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
    const partner = await this.partnersService.create(
      {
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
        roles: [PartnerRoleType.CUSTOMER],
      },
      userId,
    );
    return { id: partner.id };
  }
}
