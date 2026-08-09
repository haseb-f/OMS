import { Injectable, OnModuleInit } from '@nestjs/common';
import { CostCentersService } from '../../cost-centers/cost-centers.service';
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
    example: 'CC-100',
    uniqueWithinFile: true,
  },
  {
    key: 'name',
    labelKey: 'importCenter.fields.name',
    label: 'Name',
    required: true,
    type: 'string',
    example: 'Head Office',
  },
  {
    key: 'description',
    labelKey: 'importCenter.fields.description',
    label: 'Description',
    required: false,
    type: 'string',
  },
];

/** Cost Centers Import (Phase 2.5) — every row calls `CostCentersService.create()` unchanged. */
@Injectable()
export class CostCentersImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'COST_CENTERS';
  readonly labelKey = 'importCenter.types.costCenters.label';
  readonly descriptionKey = 'importCenter.types.costCenters.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly costCentersService: CostCentersService,
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
    const costCenter = await this.costCentersService.create(
      {
        code: row.code,
        name: row.name,
        description: row.description || undefined,
      },
      userId,
    );
    return { id: costCenter.id };
  }
}
