import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { TaxesService } from '../../taxes/taxes.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'code',
    labelKey: 'importCenter.fields.code',
    label: 'Code',
    required: true,
    type: 'string',
    example: 'VAT15',
    uniqueWithinFile: true,
  },
  {
    key: 'name',
    labelKey: 'importCenter.fields.name',
    label: 'Name',
    required: true,
    type: 'string',
    example: 'Standard VAT',
  },
  {
    key: 'rate',
    labelKey: 'importCenter.fields.rate',
    label: 'Rate (%)',
    required: true,
    type: 'number',
    example: '15',
  },
  {
    key: 'description',
    labelKey: 'importCenter.fields.description',
    label: 'Description',
    required: false,
    type: 'string',
  },
];

/** Tax Rates Import (Phase 2.5) — every row calls `TaxesService.create()` unchanged (0-100 rate validation included). */
@Injectable()
export class TaxRatesImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'TAX_RATES';
  readonly labelKey = 'importCenter.types.taxRates.label';
  readonly descriptionKey = 'importCenter.types.taxRates.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly taxesService: TaxesService,
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
    const rate = Number(row.rate);
    if (!row.rate || Number.isNaN(rate)) {
      throw new BadRequestException('Rate must be a number between 0 and 100.');
    }
    if (options?.dryRun) return { id: 'dry-run' };

    const tax = await this.taxesService.create(
      {
        code: row.code,
        name: row.name,
        rate,
        description: row.description || undefined,
      },
      userId,
    );
    return { id: tax.id };
  }
}
