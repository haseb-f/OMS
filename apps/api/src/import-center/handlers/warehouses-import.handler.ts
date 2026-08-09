import { Injectable, OnModuleInit } from '@nestjs/common';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { resolveOptionalIdByField } from '../import-value.util';
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
    example: 'Main Warehouse',
  },
  {
    key: 'warehouseType',
    labelKey: 'importCenter.fields.warehouseType',
    label: 'Warehouse Type',
    required: false,
    type: 'string',
    example: 'Distribution Center',
  },
  {
    key: 'parentWarehouseName',
    labelKey: 'importCenter.fields.parentWarehouseName',
    label: 'Parent Warehouse',
    required: false,
    type: 'string',
  },
  {
    key: 'description',
    labelKey: 'importCenter.fields.description',
    label: 'Description',
    required: false,
    type: 'string',
  },
];

/**
 * Warehouses Import (Phase 2.5) — every row calls `WarehousesService.create()`
 * unchanged; `code` is never accepted here (server-minted by the Numbering
 * Engine, same as the manual Create Warehouse form). `parentWarehouseName`
 * is the only read-only lookup this handler does itself.
 */
@Injectable()
export class WarehousesImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'WAREHOUSES';
  readonly labelKey = 'importCenter.types.warehouses.label';
  readonly descriptionKey = 'importCenter.types.warehouses.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly warehousesService: WarehousesService,
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
    const parentWarehouseId = await resolveOptionalIdByField(
      this.warehousesService,
      'name',
      row.parentWarehouseName,
      'Parent Warehouse',
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const warehouse = await this.warehousesService.create(
      {
        name: row.name,
        warehouseType: row.warehouseType || undefined,
        parentWarehouseId,
        description: row.description || undefined,
      },
      userId,
    );
    return { id: warehouse.id };
  }
}
