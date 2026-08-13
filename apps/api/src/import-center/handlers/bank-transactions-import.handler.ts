import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { CashFlowDirection, CashFlowOutgoingType } from '@prisma/client';
import { BankTransactionsService } from '../../bank-transactions/bank-transactions.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
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
    label: 'External Transaction ID',
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
    key: 'cashSourceCode',
    labelKey: 'importCenter.fields.cashSource',
    label: 'Cash Source',
    required: false,
    type: 'string',
    referenceType: 'CASH_SOURCE',
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
    referenceType: 'CURRENCY',
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
  // --- Outgoing-only classification (spec section 12) — ignored for an
  // Incoming row, never required there. ---
  {
    key: 'transactionType',
    labelKey: 'importCenter.fields.cashFlowOutgoingType',
    label: 'Transaction Type (Outgoing only)',
    required: false,
    type: 'string',
    options: ['SUPPLIER_PAYMENT', 'EXPENSE'],
  },
  {
    key: 'accountCode',
    labelKey: 'importCenter.fields.expenseAccount',
    label: 'Account (Expense — required when Transaction Type = EXPENSE)',
    required: false,
    type: 'string',
    referenceType: 'CHART_OF_ACCOUNT',
  },
  {
    key: 'partnerSupplierCode',
    labelKey: 'importCenter.fields.partnerSupplier',
    label:
      'Partner/Supplier (required when Transaction Type = SUPPLIER_PAYMENT)',
    required: false,
    type: 'string',
    referenceType: 'SUPPLIER',
  },
  {
    key: 'costCenterCode',
    labelKey: 'importCenter.fields.costCenter',
    label: 'Cost Center',
    required: false,
    type: 'string',
    referenceType: 'COST_CENTER',
  },
  {
    key: 'projectCode',
    labelKey: 'importCenter.fields.project',
    label: 'Project',
    required: false,
    type: 'string',
    referenceType: 'PROJECT',
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
 * Cash Flow Import (Bank Statement upload + Google Sheets Data
 * Synchronization) — step one of Cash Flow Transaction -> Classify
 * Incoming/Outgoing -> Reconcile/Voucher -> Posting Engine -> Journal Entry
 * (the remaining steps live in `CashFlowReconciliationService`, triggered
 * separately from the review screen, never automatically from here — spec
 * section 24: "Importing a transaction ≠ approving it").
 *
 * Two source channels share this one handler, never a parallel importer:
 *
 *   - Manual CSV/XLSX bank-statement upload — `options.context` is unset.
 *     External Transaction ID and Cash Source mapping stay OPTIONAL (many
 *     raw exports have neither), and `fingerprint` (below) remains the
 *     dedup identity, exactly as before this module.
 *   - Google Sheets Cash Flow sync (`SyncSourceConfig{sourceType:
 *     CASH_FLOW}`) — `options.context.direction`/`.cashSourceHint` are set
 *     by `SyncOrchestratorService` from the sync source's own
 *     configuration (spec section 2: one Incoming and one Outgoing Google
 *     Sheet, tabs = accounts/providers). Here, External Transaction ID
 *     AND a resolved Cash Source are REQUIRED (spec sections 3/4) — this
 *     is the one place that rule is enforced, never at the DB level, since
 *     the two channels have different guarantees.
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
    private readonly registry: ImportTypeRegistryService,
    private readonly referenceData: ReferenceDataRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async importRow(
    row: Record<string, string>,
    _userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const isGoogleSheetsSync = options?.context?.source === 'GOOGLE_SHEETS';
    const provider = options?.context?.provider;
    const importJobId = options?.context?.importJobId;
    // Set by `SyncOrchestratorService` from the sync source's own
    // configured direction (spec section 2 — one Incoming and one Outgoing
    // Google Sheet, never inferred/guessed for a Cash Flow sync row).
    const contextDirection = options?.context?.direction as
      CashFlowDirection | undefined;

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

    if (isGoogleSheetsSync && !row.transactionId?.trim()) {
      throw new BadRequestException(
        'External Transaction ID is required for a Cash Flow Google Sheets row.',
      );
    }

    const currencyId = await this.referenceData.resolveOptional(
      'CURRENCY',
      'code',
      row.currencyCode,
      'Currency',
    );
    const currencyCode = row.currencyCode?.trim().toUpperCase() ?? '';
    // The sheet's own Bank Name column wins when present (a manual
    // multi-bank statement upload, or a Cash Flow tab that happens to
    // include one); otherwise fall back to the worksheet's configured
    // provider label.
    const bankName = row.bankName || provider || undefined;

    const cashSourceId = await this.referenceData.resolveOptional(
      'CASH_SOURCE',
      'name',
      row.cashSourceCode,
      'Cash Source',
    );
    if (isGoogleSheetsSync && !cashSourceId) {
      throw new BadRequestException(
        'Cash Source is required for a Cash Flow Google Sheets row — map it to an existing Receiving Account, never a free-text bank name.',
      );
    }

    const direction: CashFlowDirection | undefined =
      contextDirection ??
      (isGoogleSheetsSync
        ? undefined
        : amount >= 0
          ? CashFlowDirection.INCOMING
          : CashFlowDirection.OUTGOING);

    const outgoingType = row.transactionType?.trim().toUpperCase() as
      CashFlowOutgoingType | undefined;
    if (
      outgoingType &&
      !Object.values(CashFlowOutgoingType).includes(outgoingType)
    ) {
      throw new BadRequestException(
        `Transaction Type must be one of: ${Object.values(CashFlowOutgoingType).join(', ')}.`,
      );
    }

    const expenseAccountId = await this.referenceData.resolveOptional(
      'CHART_OF_ACCOUNT',
      'code',
      row.accountCode,
      'Account',
    );
    if (outgoingType === CashFlowOutgoingType.EXPENSE && !expenseAccountId) {
      throw new BadRequestException(
        'Account (Expense) is required when Transaction Type is EXPENSE.',
      );
    }
    const partnerSupplierId = await this.referenceData.resolveOptional(
      'SUPPLIER',
      'name',
      row.partnerSupplierCode,
      'Partner/Supplier',
    );
    if (
      outgoingType === CashFlowOutgoingType.SUPPLIER_PAYMENT &&
      !partnerSupplierId
    ) {
      throw new BadRequestException(
        'Partner/Supplier is required when Transaction Type is SUPPLIER_PAYMENT.',
      );
    }
    const costCenterId = await this.referenceData.resolveOptional(
      'COST_CENTER',
      'code',
      row.costCenterCode,
      'Cost Center',
    );
    const projectId = await this.referenceData.resolveOptional(
      'PROJECT',
      'code',
      row.projectCode,
      'Project',
    );

    // Deliberately unchanged from the pre-Cash-Flow formula (date+amount+
    // reference+description+account+currency only) — folding `bankName`/
    // `provider`/`transactionId` in here would silently change the
    // fingerprint of every already-imported row. `transactionId`+
    // `cashSourceId` is the REAL idempotency key when both are present
    // (`BankTransactionsService.upsertFromImport`) — this fingerprint stays
    // only as the fallback for a source with neither.
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
      bankName,
      importJobId: importJobId || undefined,
      branch: row.branch || undefined,
      notes: row.notes || undefined,
      direction,
      cashSourceId,
      outgoingType,
      expenseAccountId,
      partnerSupplierId,
      costCenterId,
      projectId,
    });

    // A CONFLICT is still a successful import (the row was safely written/
    // recognized) — it's surfaced to the user via `matchStatus: CONFLICT`
    // on the row itself, never as an import error (spec section 20: "do
    // not silently overwrite... mark it for review", not "fail the sync").
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
