import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { ChartOfAccountsService } from '../../chart-of-accounts/chart-of-accounts.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { parseBoolean, resolveOptionalIdByField } from '../import-value.util';
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
    example: '1100',
    uniqueWithinFile: true,
  },
  {
    key: 'name',
    labelKey: 'importCenter.fields.name',
    label: 'Name',
    required: true,
    type: 'string',
    example: 'Accounts Receivable',
  },
  {
    key: 'accountType',
    labelKey: 'importCenter.fields.accountType',
    label: 'Account Type',
    required: true,
    type: 'string',
    example: 'ASSET',
    options: Object.values(AccountType),
  },
  {
    key: 'parentAccountCode',
    labelKey: 'importCenter.fields.parentAccountCode',
    label: 'Parent Account Code',
    required: false,
    type: 'string',
    referenceType: 'CHART_OF_ACCOUNT',
    referenceMatchField: 'code',
  },
  {
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency Code',
    required: false,
    type: 'string',
    example: 'SAR',
    referenceType: 'CURRENCY',
    referenceMatchField: 'code',
  },
  {
    key: 'allowReconciliation',
    labelKey: 'importCenter.fields.allowReconciliation',
    label: 'Allow Reconciliation',
    required: false,
    type: 'boolean',
    example: 'TRUE',
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
 * Chart of Accounts Import (Phase 2.5) — every row calls
 * `ChartOfAccountsService.create()` unchanged, so the parent-exists check
 * that service already runs applies identically here. `parentAccountCode`/
 * `currencyCode` are read-only lookups this handler resolves itself.
 */
@Injectable()
export class ChartOfAccountsImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'CHART_OF_ACCOUNTS';
  readonly labelKey = 'importCenter.types.chartOfAccounts.label';
  readonly descriptionKey = 'importCenter.types.chartOfAccounts.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;

  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly currenciesService: CurrenciesService,
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
    const accountType = row.accountType?.trim().toUpperCase();
    if (
      !accountType ||
      !Object.values(AccountType).includes(accountType as AccountType)
    ) {
      throw new BadRequestException(
        `Invalid account type "${row.accountType}" — expected one of ${Object.values(AccountType).join(', ')}.`,
      );
    }

    const parentAccountId = await resolveOptionalIdByField(
      this.chartOfAccountsService,
      'code',
      row.parentAccountCode,
      'Parent Account Code',
    );
    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      row.currencyCode,
      'Currency Code',
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const account = await this.chartOfAccountsService.create(
      {
        // Bulk-importing a chart of accounts is itself a privileged setup
        // operation (Part 12) — every imported row's explicit code goes
        // through the same `codeOverride` gate a manual override would,
        // never a silent bypass just because it came from a spreadsheet.
        codeOverride: row.code,
        name: row.name,
        accountType: accountType as AccountType,
        parentAccountId,
        currencyId,
        allowReconciliation: parseBoolean(row.allowReconciliation),
        description: row.description || undefined,
      },
      userId,
    );
    return { id: account.id };
  }
}
