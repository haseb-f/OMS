import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InventoryService } from '../../inventory/inventory.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { resolveRequiredIdByField } from '../import-value.util';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'productSku',
    labelKey: 'importCenter.fields.productSku',
    label: 'Product SKU',
    required: true,
    type: 'string',
    example: 'PRD-000123',
    referenceType: 'PRODUCT',
    referenceMatchField: 'code',
  },
  {
    key: 'warehouseCode',
    labelKey: 'importCenter.fields.warehouseCode',
    label: 'Warehouse Code',
    required: true,
    type: 'string',
    example: 'MAIN',
    referenceType: 'WAREHOUSE',
    referenceMatchField: 'code',
  },
  {
    key: 'quantity',
    labelKey: 'importCenter.fields.quantity',
    label: 'Quantity',
    required: true,
    type: 'number',
    example: '100',
  },
  {
    key: 'unitCost',
    labelKey: 'importCenter.fields.unitCost',
    label: 'Unit Cost',
    required: false,
    type: 'number',
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
 * Opening Stock Import (Phase 1, Inventory) — every row calls
 * `InventoryService.openingBalance()` unchanged, the same Inventory Engine
 * business operation the manual "Opening Inventory" dialog uses (append-only
 * `OPENING_BALANCE` movement, never a direct quantity write). Distinct from
 * Inventory Adjustments (`InventoryAdjustmentsImportHandler`) and from the
 * accounting Opening Balances (Chart of Accounts) — this is warehouse stock
 * quantity only.
 */
@Injectable()
export class OpeningStockImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'OPENING_STOCK';
  readonly labelKey = 'importCenter.types.openingStock.label';
  readonly descriptionKey = 'importCenter.types.openingStock.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly productsService: ProductsService,
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
    const productId = await resolveRequiredIdByField(
      this.productsService,
      'sku',
      row.productSku,
      'Product SKU',
    );
    const warehouseId = await resolveRequiredIdByField(
      this.warehousesService,
      'code',
      row.warehouseCode,
      'Warehouse Code',
    );

    const quantity = Number(row.quantity);
    if (!row.quantity || !Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException(
        'Quantity must be a positive whole number.',
      );
    }
    const unitCost = row.unitCost ? Number(row.unitCost) : undefined;
    if (row.unitCost && (Number.isNaN(unitCost) || (unitCost as number) < 0)) {
      throw new BadRequestException('Unit Cost must be a non-negative number.');
    }

    if (options?.dryRun) return { id: 'dry-run' };

    const movement = await this.inventoryService.openingBalance(
      {
        productId,
        warehouseId,
        quantity,
        unitCost,
        notes: row.notes || undefined,
      },
      userId,
    );
    return { id: movement.id };
  }
}
