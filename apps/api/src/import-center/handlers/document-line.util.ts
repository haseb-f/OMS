import { BadRequestException } from '@nestjs/common';
import { ProductsService } from '../../products/products.service';
import { UnitsService } from '../../units/units.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { TaxesService } from '../../taxes/taxes.service';
import {
  resolveOptionalIdByField,
  resolveRequiredIdByField,
} from '../import-value.util';

/**
 * TASK-059 — shared "one CSV row = one document line" resolution, reused by
 * every Sales/Purchase document import handler so the SKU/Unit/Warehouse/Tax
 * lookup logic exists exactly once, never copy-pasted per document type.
 */
export async function resolveProductBySku(
  productsService: ProductsService,
  sku: string | undefined,
): Promise<{ id: string; unitId: string }> {
  const trimmed = sku?.trim();
  if (!trimmed) {
    throw new BadRequestException('Product SKU is required.');
  }
  const result = await productsService.findAll({
    search: trimmed,
    pageSize: 20,
  });
  const match = result.items.find(
    (item) => item.sku.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!match) {
    throw new BadRequestException(`Product with SKU "${trimmed}" not found.`);
  }
  return { id: match.id, unitId: match.unitId };
}

/** "Unit" stays optional on the template — an omitted cell falls back to the product's own default unit, the same default a manual ProductPicker selection applies. */
export async function resolveLineUnitId(
  unitsService: UnitsService,
  unitName: string | undefined,
  fallbackUnitId: string,
): Promise<string> {
  const resolved = await resolveOptionalIdByField(
    unitsService,
    'name',
    unitName,
    'Unit',
  );
  return resolved ?? fallbackUnitId;
}

/** Warehouse is required on Order/Invoice/Return lines and optional on Quotation lines — the same "conditionally required, decided by the caller" split every manual document editor already enforces. */
export async function resolveLineWarehouseId(
  warehousesService: WarehousesService,
  warehouseName: string | undefined,
  required: boolean,
): Promise<string | undefined> {
  if (required) {
    return resolveRequiredIdByField(
      warehousesService,
      'name',
      warehouseName,
      'Warehouse',
    );
  }
  return resolveOptionalIdByField(
    warehousesService,
    'name',
    warehouseName,
    'Warehouse',
  );
}

export function resolveLineTaxId(
  taxesService: TaxesService,
  taxName: string | undefined,
): Promise<string | undefined> {
  return resolveOptionalIdByField(taxesService, 'name', taxName, 'Tax');
}

export function parseLineQuantity(value: string | undefined): number {
  const quantity = Number(value);
  if (!value || !Number.isFinite(quantity) || quantity <= 0) {
    throw new BadRequestException(
      `Quantity must be a positive number (got "${value}").`,
    );
  }
  return quantity;
}

export function parseLineUnitPrice(value: string | undefined): number {
  const unitPrice = Number(value);
  if (!value || !Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new BadRequestException(
      `Unit Price must be a non-negative number (got "${value}").`,
    );
  }
  return unitPrice;
}

export function parseOptionalNumber(
  value: string | undefined,
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Shared line-field schema every Sales/Purchase document import type extends — matches `import-type.interface.ts`'s `ImportFieldDef` shape. */
export const PRODUCT_LINE_FIELDS = {
  productSku: {
    key: 'productSku',
    labelKey: 'importCenter.fields.productSku',
    label: 'Product SKU',
    required: true as const,
    type: 'string' as const,
    example: 'PRD-000123',
  },
  description: {
    key: 'description',
    labelKey: 'importCenter.fields.lineDescription',
    label: 'Line Description',
    required: false as const,
    type: 'string' as const,
  },
  warehouseName: {
    key: 'warehouseName',
    labelKey: 'importCenter.fields.warehouseName',
    label: 'Warehouse',
    required: false as const,
    type: 'string' as const,
  },
  unitName: {
    key: 'unitName',
    labelKey: 'importCenter.fields.unitName',
    label: 'Unit',
    required: false as const,
    type: 'string' as const,
    example: 'Defaults to the product’s own unit when left blank',
  },
  quantity: {
    key: 'quantity',
    labelKey: 'importCenter.fields.quantity',
    label: 'Quantity',
    required: true as const,
    type: 'number' as const,
    example: '10',
  },
  unitPrice: {
    key: 'unitPrice',
    labelKey: 'importCenter.fields.unitPrice',
    label: 'Unit Price',
    required: true as const,
    type: 'number' as const,
    example: '100',
  },
  discountPercent: {
    key: 'discountPercent',
    labelKey: 'importCenter.fields.discountPercent',
    label: 'Discount %',
    required: false as const,
    type: 'number' as const,
  },
  taxName: {
    key: 'taxName',
    labelKey: 'importCenter.fields.taxName',
    label: 'Tax',
    required: false as const,
    type: 'string' as const,
  },
};
