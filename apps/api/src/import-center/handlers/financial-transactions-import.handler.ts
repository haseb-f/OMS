import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  FinancialTransactionsService,
  type FinancialTransactionCreateInput,
} from '../../financial-transactions/financial-transactions.service';
import { CustomersService } from '../../customers/customers.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { SalesInvoicesService } from '../../sales/invoices/sales-invoices.service';
import { PurchaseInvoicesService } from '../../purchasing/invoices/purchase-invoices.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import {
  resolveOptionalIdByField,
  resolveRequiredIdByField,
} from '../import-value.util';
import { parseOptionalNumber } from './document-line.util';
import {
  FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS,
  resolveFinancialTransactionType,
} from '../../financial-transactions/financial-transaction-type.catalog';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

function fields(partyLabelKey: string, partyLabel: string): ImportFieldDef[] {
  return [
    {
      key: 'transactionNumber',
      labelKey: 'importCenter.fields.transactionNumber',
      label: 'Transaction Number',
      required: true,
      type: 'string',
      example: 'Groups multiple allocation rows into one transaction',
    },
    {
      key: 'partyName',
      labelKey: partyLabelKey,
      label: partyLabel,
      required: true,
      type: 'string',
    },
    {
      key: 'amount',
      labelKey: 'importCenter.fields.amount',
      label: 'Amount',
      required: true,
      type: 'number',
      example: '1000',
    },
    {
      key: 'currencyCode',
      labelKey: 'importCenter.fields.currencyCode',
      label: 'Currency Code',
      required: false,
      type: 'string',
      referenceType: 'CURRENCY',
    },
    {
      key: 'referenceNumber',
      labelKey: 'importCenter.fields.referenceNumber',
      label: 'Reference Number',
      required: false,
      type: 'string',
    },
    {
      key: 'invoiceNumber',
      labelKey: 'importCenter.fields.invoiceNumber',
      label: 'Invoice Number',
      required: false,
      type: 'string',
      example: 'Leave blank for an unallocated / advance amount',
    },
    {
      key: 'transactionType',
      labelKey: 'importCenter.fields.financialTransactionType',
      label: 'Financial Transaction Type',
      required: false,
      type: 'string',
      example: 'تحصيل من عميل',
    },
    {
      key: 'allocatedAmount',
      labelKey: 'importCenter.fields.allocatedAmount',
      label: 'Allocated Amount',
      required: false,
      type: 'number',
    },
  ];
}

/**
 * TASK-059 — shared build logic behind both Customer Receipts and Supplier
 * Payments import: one `FinancialTransactionsService.create()` call per
 * `transactionNumber` group, with each row optionally allocating part of the
 * amount to an invoice (rows with no `invoiceNumber` are unallocated —
 * Advance Payment / Overpayment, matching the Matching Engine's own rules).
 */
function assertTransactionType(
  raw: string | undefined,
  expected: 'CUSTOMER_RECEIPT' | 'SUPPLIER_PAYMENT',
) {
  if (!raw?.trim()) return;
  const resolved = resolveFinancialTransactionType(raw);
  if (!resolved) {
    throw new BadRequestException(
      `Financial Transaction Type must match an OMS type (code or Arabic label).`,
    );
  }
  if (resolved !== expected) {
    throw new BadRequestException(
      `Financial Transaction Type must be ${FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS[expected] ?? expected}.`,
    );
  }
}

async function buildAndCreate(
  service: FinancialTransactionsService,
  type: 'CUSTOMER_RECEIPT' | 'SUPPLIER_PAYMENT',
  partyId: string,
  currencyId: string | undefined,
  salesInvoicesService: SalesInvoicesService,
  purchaseInvoicesService: PurchaseInvoicesService,
  rows: Record<string, string>[],
  userId?: string,
): Promise<ImportRowResult> {
  const first = rows[0];
  const amount = parseOptionalNumber(first.amount);
  if (amount === undefined || amount <= 0) {
    throw new BadRequestException('Amount must be a positive number.');
  }

  const allocations: { invoiceId: string; allocatedAmount: number }[] = [];
  for (const row of rows) {
    const invoiceNumber = row.invoiceNumber?.trim();
    if (!invoiceNumber) continue;
    const allocatedAmount = parseOptionalNumber(row.allocatedAmount);
    if (allocatedAmount === undefined || allocatedAmount <= 0) {
      throw new BadRequestException(
        `Allocated Amount is required and must be positive when Invoice Number "${invoiceNumber}" is set.`,
      );
    }
    const invoiceId =
      type === 'CUSTOMER_RECEIPT'
        ? await resolveRequiredIdByField(
            salesInvoicesService,
            'invoiceNumber',
            invoiceNumber,
            'Sales Invoice',
          )
        : await resolveRequiredIdByField(
            purchaseInvoicesService,
            'invoiceNumber',
            invoiceNumber,
            'Purchase Invoice',
          );
    allocations.push({ invoiceId, allocatedAmount });
  }

  const input: FinancialTransactionCreateInput = {
    customerId: type === 'CUSTOMER_RECEIPT' ? partyId : undefined,
    supplierId: type === 'SUPPLIER_PAYMENT' ? partyId : undefined,
    currencyId,
    amount,
    referenceNumber: first.referenceNumber || undefined,
    allocations: allocations.length > 0 ? allocations : undefined,
  };

  const transaction = await service.create(type, input, userId);
  return { id: transaction.id };
}

@Injectable()
export class CustomerReceiptsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'CUSTOMER_RECEIPTS';
  readonly labelKey = 'importCenter.types.customerReceipts.label';
  readonly descriptionKey = 'importCenter.types.customerReceipts.description';
  readonly fields = fields('importCenter.fields.customerName', 'Customer Name');
  readonly isAvailable = true;
  readonly groupKey = 'transactionNumber';

  constructor(
    private readonly financialTransactionsService: FinancialTransactionsService,
    private readonly customersService: CustomersService,
    private readonly salesInvoicesService: SalesInvoicesService,
    private readonly purchaseInvoicesService: PurchaseInvoicesService,
    private readonly currenciesService: CurrenciesService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    return this.importGroup([row], userId, options);
  }

  async importGroup(
    rows: Record<string, string>[],
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const first = rows[0];
    assertTransactionType(first.transactionType, 'CUSTOMER_RECEIPT');
    const customerId = await resolveRequiredIdByField(
      this.customersService,
      'name',
      first.partyName,
      'Customer',
    );
    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      first.currencyCode,
      'Currency Code',
    );
    if (options?.dryRun) return { id: 'dry-run' };
    return buildAndCreate(
      this.financialTransactionsService,
      'CUSTOMER_RECEIPT',
      customerId,
      currencyId,
      this.salesInvoicesService,
      this.purchaseInvoicesService,
      rows,
      userId,
    );
  }
}

@Injectable()
export class SupplierPaymentsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'SUPPLIER_PAYMENTS';
  readonly labelKey = 'importCenter.types.supplierPayments.label';
  readonly descriptionKey = 'importCenter.types.supplierPayments.description';
  readonly fields = fields('importCenter.fields.supplierName', 'Supplier Name');
  readonly isAvailable = true;
  readonly groupKey = 'transactionNumber';

  constructor(
    private readonly financialTransactionsService: FinancialTransactionsService,
    private readonly suppliersService: SuppliersService,
    private readonly salesInvoicesService: SalesInvoicesService,
    private readonly purchaseInvoicesService: PurchaseInvoicesService,
    private readonly currenciesService: CurrenciesService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    return this.importGroup([row], userId, options);
  }

  async importGroup(
    rows: Record<string, string>[],
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const first = rows[0];
    assertTransactionType(first.transactionType, 'SUPPLIER_PAYMENT');
    const supplierId = await resolveRequiredIdByField(
      this.suppliersService,
      'name',
      first.partyName,
      'Supplier',
    );
    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      first.currencyCode,
      'Currency Code',
    );
    if (options?.dryRun) return { id: 'dry-run' };
    return buildAndCreate(
      this.financialTransactionsService,
      'SUPPLIER_PAYMENT',
      supplierId,
      currencyId,
      this.salesInvoicesService,
      this.purchaseInvoicesService,
      rows,
      userId,
    );
  }
}
