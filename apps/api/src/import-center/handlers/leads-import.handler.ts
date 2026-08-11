import { Injectable, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { LeadSource } from '@prisma/client';
import { LeadsService } from '../../leads/leads.service';
import { CountriesService } from '../../countries/countries.service';
import { UsersService } from '../../users/users.service';
import { ProductsService } from '../../products/products.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
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
    label: 'External Lead ID',
    required: false,
    type: 'string',
    example: 'FB-LEAD-4821',
    uniqueWithinFile: true,
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
    key: 'mobileNumber',
    labelKey: 'importCenter.fields.mobileNumber',
    label: 'Phone',
    required: true,
    type: 'string',
    example: '+966501234567',
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
    required: false,
    type: 'string',
  },
  {
    key: 'address',
    labelKey: 'importCenter.fields.address',
    label: 'Detailed Address',
    required: false,
    type: 'string',
  },
  {
    key: 'productSku',
    labelKey: 'importCenter.fields.productSku',
    label: 'Product (SKU)',
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
 * Leads Import (TASK-061 follow-up, Part 6) — the minimal Lead sheet:
 * `customerName`/`mobileNumber`/`countryName` are the only required columns,
 * matching the same "Lead needs only name/phone/country" rule the manual
 * Lead/Order create dialog enforces (Part 1) — everything else here is
 * optional and completed later via edit, exactly like a manually-created
 * Lead. Split from Orders (see `orders-import.handler.ts`) since the two
 * need different minimum-field rules; both call the same
 * `LeadsService.create()` (`recordType: 'LEAD'`, the default), so Duplicate
 * Lead detection, Customer Master matching, and Auto Assignment all apply
 * identically to an imported row as to a manually-created Lead.
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
    private readonly usersService: UsersService,
    private readonly productsService: ProductsService,
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
    const countryId = await resolveRequiredIdByField(
      this.countriesService,
      'name',
      row.countryName,
      'Country',
    );
    const salesEmployeeId = await this.resolveAgent(row.agentEmail);
    const productId = await resolveOptionalIdByField(
      this.productsService,
      'sku',
      row.productSku,
      'Product',
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
        recordType: 'LEAD',
        customerName: row.customerName,
        mobileNumber: row.mobileNumber,
        countryId,
        city: row.city || undefined,
        address: row.address || undefined,
        productId,
        source: LeadSource.EXCEL,
        salesEmployeeId,
        externalOrderId: row.externalOrderId || undefined,
        importBatch: `import-center-${new Date().toISOString().slice(0, 10)}`,
      },
      userId,
    );

    if (row.notes) {
      await this.leadsService.recordImportedOrderDetails(lead.id, {
        notes: row.notes,
      });
    }

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
