import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InventoryService } from '../../inventory/inventory.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
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
    example: '10 or -5',
  },
  {
    key: 'reason',
    labelKey: 'importCenter.fields.reason',
    label: 'Reason',
    required: true,
    type: 'string',
    example: 'Stock count correction',
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
 * Inventory Adjustments Import (TASK-056) — every row calls
 * `InventoryService.adjustment()` unchanged, so the same
 * negative-stock guard and append-only InventoryMovement/Posting Engine
 * entry the manual Adjustment form produces applies identically here.
 * `productSku`/`warehouseCode` are read-only lookups this handler resolves
 * itself — never a write.
 */
@Injectable()
export class InventoryAdjustmentsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'INVENTORY_ADJUSTMENTS';
  readonly labelKey = 'importCenter.types.inventoryAdjustments.label';
  readonly descriptionKey =
    'importCenter.types.inventoryAdjustments.description';
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
    const sku = row.productSku?.trim();
    if (!sku) throw new BadRequestException('Product SKU is required.');
    const productResult = await this.productsService.findAll({
      search: sku,
      pageSize: 20,
    });
    const product = (productResult.items as { id: string; sku: string }[]).find(
      (item) => item.sku.toLowerCase() === sku.toLowerCase(),
    );
    if (!product)
      throw new BadRequestException(`Product with SKU "${sku}" not found.`);

    const code = row.warehouseCode?.trim();
    if (!code) throw new BadRequestException('Warehouse Code is required.');
    const warehouseResult = await this.warehousesService.findAll({
      search: code,
      pageSize: 20,
    });
    const warehouse = (
      warehouseResult.items as { id: string; code: string }[]
    ).find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!warehouse)
      throw new BadRequestException(`Warehouse with code "${code}" not found.`);

    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity === 0) {
      throw new BadRequestException(
        'Quantity must be a non-zero whole number.',
      );
    }
    if (!row.reason?.trim()) {
      throw new BadRequestException('Reason is required.');
    }

    if (options?.dryRun) return { id: 'dry-run' };

    const movement = await this.inventoryService.adjustment(
      {
        productId: product.id,
        warehouseId: warehouse.id,
        quantity,
        reason: row.reason,
        notes: row.notes || undefined,
      },
      userId,
    );
    return { id: movement.id };
  }
}
