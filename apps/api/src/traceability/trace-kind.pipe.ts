import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { TraceKind } from './traceability.types';

export const TRACE_KINDS: readonly TraceKind[] = [
  'SALES_QUOTATION',
  'SALES_ORDER',
  'SALES_INVOICE',
  'SALES_RETURN',
  'CUSTOMER_RECEIPT',
  'CUSTOMER_REFUND',
  'CUSTOMER',
  'PURCHASE_QUOTATION',
  'PURCHASE_ORDER',
  'PURCHASE_INVOICE',
  'PURCHASE_RETURN',
  'SUPPLIER_PAYMENT',
  'EXPENSE_PAYMENT',
  'LANDED_COST',
  'STORE_ORDER',
  'PAYMENT',
  'SHIPMENT',
  'JOURNAL_ENTRY',
  'INVENTORY_MOVEMENT',
  'FIXED_ASSET',
  'PREPAID_EXPENSE',
];

@Injectable()
export class TraceKindPipe implements PipeTransform<string, TraceKind> {
  transform(value: string): TraceKind {
    const kind = value?.toUpperCase() as TraceKind;
    if (!TRACE_KINDS.includes(kind)) {
      throw new BadRequestException('Unknown record type "' + value + '".');
    }
    return kind;
  }
}
