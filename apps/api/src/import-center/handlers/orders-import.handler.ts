import { Injectable, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ImportTypeRegistryService } from '../import-type-registry.service';
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
    label: 'External Order ID',
    required: true,
    type: 'string',
    example: 'SH-100234',
    uniqueWithinFile: true,
  },
];

/**
 * Retired Lead-as-Order importer. Operational orders use STORE_ORDERS;
 * CRM prospects use LEADS. Kept registered so Import Center can show it
 * as unavailable rather than a missing type.
 */
@Injectable()
export class OrdersImportHandler implements ImportTypeHandler, OnModuleInit {
  readonly type = 'ORDERS';
  readonly labelKey = 'importCenter.types.orders.label';
  readonly descriptionKey = 'importCenter.types.orders.description';
  readonly fields = FIELDS;
  readonly isAvailable = false;

  constructor(private readonly registry: ImportTypeRegistryService) {}

  onModuleInit() {
    this.registry.register(this);
  }

  importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    void row;
    void userId;
    void options;
    return Promise.reject(
      new BadRequestException(
        'Lead-as-Order import is retired. Use Store Orders import (STORE_ORDERS) for operational orders, or Leads import for CRM prospects.',
      ),
    );
  }
}
