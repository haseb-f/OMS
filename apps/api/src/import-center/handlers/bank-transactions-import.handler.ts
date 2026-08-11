import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { BankTransactionsService } from '../../bank-transactions/bank-transactions.service';
import { CurrenciesService } from '../../currencies/currencies.service';
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
    key: 'transactionId',
    labelKey: 'importCenter.fields.bankTransactionId',
    label: 'Transaction ID',
    required: false,
    type: 'string',
  },
  {
    key: 'transactionDate',
    labelKey: 'importCenter.fields.transactionDate',
    label: 'Transaction Date',
    required: true,
    type: 'date',
    example: '2026-08-01',
  },
  {
    key: 'valueDate',
    labelKey: 'importCenter.fields.valueDate',
    label: 'Value Date',
    required: false,
    type: 'date',
  },
  {
    key: 'account',
    labelKey: 'importCenter.fields.bankAccountNumber',
    label: 'Account',
    required: false,
    type: 'string',
  },
  {
    key: 'reference',
    labelKey: 'importCenter.fields.bankReference',
    label: 'Reference',
    required: false,
    type: 'string',
  },
  {
    key: 'description',
    labelKey: 'importCenter.fields.lineDescription',
    label: 'Description',
    required: false,
    type: 'string',
  },
  {
    key: 'debit',
    labelKey: 'importCenter.fields.debit',
    label: 'Debit',
    required: false,
    type: 'number',
  },
  {
    key: 'credit',
    labelKey: 'importCenter.fields.credit',
    label: 'Credit',
    required: false,
    type: 'number',
  },
  {
    key: 'amount',
    labelKey: 'importCenter.fields.bankAmount',
    label: 'Amount (signed — leave blank if using Debit/Credit)',
    required: false,
    type: 'number',
  },
  {
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency',
    required: false,
    type: 'string',
    example: 'SAR',
  },
  {
    key: 'balance',
    labelKey: 'importCenter.fields.balance',
    label: 'Balance',
    required: false,
    type: 'number',
  },
  {
    key: 'bankName',
    labelKey: 'importCenter.fields.bankName',
    label: 'Bank Name',
    required: false,
    type: 'string',
  },
  {
    key: 'branch',
    labelKey: 'importCenter.fields.branch',
    label: 'Branch',
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
];

/**
 * Bank Statement Import (Part 6/9/10) — step one of Bank Transaction ->
 * Find Matching Order -> Match Payment -> Update Payment Status -> Create
 * reconciliation record (the remaining steps live in
 * `BankTransactionsService`/`PaymentAutoMatchingService`, triggered
 * separately from the review screen, never automatically from here).
 *
 * Every bank exports differently — some give a single signed `amount`
 * column, others separate `debit`/`credit` columns — so both are accepted
 * and normalized to one signed `amount` here (credit positive, debit
 * negative), never assuming one shape. Deduplication never relies on row
 * position or a bank-supplied transaction ID (many exports have none): a
 * deterministic fingerprint of date+amount+reference+description+account+
 * currency is computed for every row and upserted by that
 * (`BankTransactionsService.upsertFromImport`), so a reimported statement
 * recognizes the same row even if it shifted to a different line.
 */
@Injectable()
export class BankTransactionsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'BANK_TRANSACTIONS';
  readonly labelKey = 'importCenter.types.bankTransactions.label';
  readonly descriptionKey = 'importCenter.types.bankTransactions.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly bankTransactionsService: BankTransactionsService,
    private readonly currenciesService: CurrenciesService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    _userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const transactionDate = parseDate(row.transactionDate, 'Transaction Date');
    const valueDate = row.valueDate
      ? parseDate(row.valueDate, 'Value Date')
      : undefined;

    const debit = parseOptionalNumber(row.debit, 'Debit');
    const credit = parseOptionalNumber(row.credit, 'Credit');
    const explicitAmount = parseOptionalNumber(row.amount, 'Amount');

    let amount: number;
    if (explicitAmount !== undefined) {
      amount = explicitAmount;
    } else if (debit !== undefined || credit !== undefined) {
      amount = (credit ?? 0) - (debit ?? 0);
    } else {
      throw new BadRequestException(
        'Provide either Amount, or Debit/Credit, for every row.',
      );
    }

    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      row.currencyCode,
      'Currency',
    );
    const currencyCode = row.currencyCode?.trim().toUpperCase() ?? '';

    const fingerprint = computeFingerprint({
      transactionDate,
      amount,
      reference: row.reference,
      description: row.description,
      account: row.account,
      currencyCode,
    });

    if (options?.dryRun) return { id: 'dry-run' };

    const balance = parseOptionalNumber(row.balance, 'Balance');

    const result = await this.bankTransactionsService.upsertFromImport({
      fingerprint,
      transactionId: row.transactionId || undefined,
      transactionDate,
      valueDate,
      account: row.account || undefined,
      reference: row.reference || undefined,
      description: row.description || undefined,
      debit,
      credit,
      amount,
      currencyId,
      balance,
      bankName: row.bankName || undefined,
      branch: row.branch || undefined,
      notes: row.notes || undefined,
    });

    return { id: result.id };
  }
}

function parseDate(value: string | undefined, label: string): Date {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(`${label} is required.`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} "${trimmed}" is not a valid date.`);
  }
  return parsed;
}

function parseOptionalNumber(
  value: string | undefined,
  label: string,
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new BadRequestException(`${label} "${trimmed}" is not a number.`);
  }
  return parsed;
}

/** Stable business identity for a bank statement row with no reliable transaction ID — see the handler's own doc comment. */
function computeFingerprint(fields: {
  transactionDate: Date;
  amount: number;
  reference: string | undefined;
  description: string | undefined;
  account: string | undefined;
  currencyCode: string;
}): string {
  const canonical = [
    fields.transactionDate.toISOString().slice(0, 10),
    fields.amount.toFixed(2),
    (fields.reference ?? '').trim().toLowerCase(),
    (fields.description ?? '').trim().toLowerCase(),
    (fields.account ?? '').trim().toLowerCase(),
    fields.currencyCode,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}
