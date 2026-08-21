import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChartOfAccountsService } from '../../chart-of-accounts/chart-of-accounts.service';
import {
  ACCOUNT_KIND,
  parseAccountKind,
} from '../../chart-of-accounts/coa.constants';
import { validateCoaImportGraph } from '../../chart-of-accounts/coa-graph';
import { ROOT_CODE_BY_ACCOUNT_TYPE } from '../../chart-of-accounts/code-generation.constants';
import { CurrenciesService } from '../../currencies/currencies.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { parseBoolean, resolveOptionalIdByField } from '../import-value.util';
import { getReferenceCache } from '../reference-data/reference-cache';
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
    example: '11101',
    uniqueWithinFile: true,
  },
  {
    key: 'name',
    labelKey: 'importCenter.fields.name',
    label: 'Name',
    required: true,
    type: 'string',
    example: 'الصندوق',
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
    example: '111',
    referenceType: 'CHART_OF_ACCOUNT',
    referenceMatchField: 'code',
  },
  {
    key: 'accountKind',
    labelKey: 'importCenter.fields.accountKind',
    label: 'Account Kind',
    required: true,
    type: 'string',
    example: 'POSTING',
    options: [ACCOUNT_KIND.POSTING, ACCOUNT_KIND.AGGREGATION],
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

const CODE_TO_ROW_KEY = 'ChartOfAccountsImport:codeToRow';
const EXISTING_BY_CODE_KEY = 'ChartOfAccountsImport:existingByCode';
const CREATED_BY_CODE_KEY = 'ChartOfAccountsImport:createdByCode';
const GRAPH_VALIDATED_KEY = 'ChartOfAccountsImport:graphValidated';

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
    private readonly prisma: PrismaService,
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly currenciesService: CurrenciesService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async preloadRows(rows: Record<string, string>[]): Promise<void> {
    const cache = getReferenceCache();
    if (!cache) return;

    await this.chartOfAccountsService.ensureAllSystemRoots();

    const codeToRow = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const code = row.code?.trim();
      if (code) codeToRow.set(code, row);
    }
    cache.set(CODE_TO_ROW_KEY, codeToRow);

    const existing = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        level: true,
        parentAccount: { select: { code: true } },
      },
    });
    cache.set(
      EXISTING_BY_CODE_KEY,
      new Map(existing.map((a) => [a.code, a.id])),
    );
    cache.set(CREATED_BY_CODE_KEY, new Map<string, string>());

    const graphErrors = validateCoaImportGraph(
      [...codeToRow.values()].map((row) => ({
        code: row.code ?? '',
        name: row.name ?? '',
        accountType: row.accountType ?? '',
        parentAccountCode: row.parentAccountCode ?? '',
        accountKind: row.accountKind ?? '',
      })),
      existing.map((row) => ({
        code: row.code,
        name: row.name,
        accountType: row.accountType,
        parentCode: row.parentAccount?.code ?? null,
        level: row.level,
      })),
    );
    if (graphErrors.length > 0) {
      throw new BadRequestException(
        graphErrors
          .map((error) => `${error.code || '—'}: ${error.message}`)
          .join(' | '),
      );
    }
    cache.set(GRAPH_VALIDATED_KEY, true);
  }

  async importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const code = row.code?.trim();
    if (!code) {
      throw new BadRequestException('Code is required.');
    }

    const cache = getReferenceCache();
    const createdByCode =
      (cache?.get(CREATED_BY_CODE_KEY) as Map<string, string> | undefined) ??
      new Map<string, string>();
    if (!cache) {
      const codeToRow = new Map([[code, row]]);
      return this.upsertAccountForCode(
        code,
        codeToRow,
        createdByCode,
        new Set(),
        userId,
        options,
      );
    }

    const existing = createdByCode.get(code);
    if (existing) return { id: existing };

    const codeToRow =
      (cache.get(CODE_TO_ROW_KEY) as
        Map<string, Record<string, string>> | undefined) ??
      new Map([[code, row]]);
    return this.upsertAccountForCode(
      code,
      codeToRow,
      createdByCode,
      new Set(),
      userId,
      options,
    );
  }

  private async upsertAccountForCode(
    code: string,
    codeToRow: Map<string, Record<string, string>>,
    createdByCode: Map<string, string>,
    resolving: Set<string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const alreadyCreated = createdByCode.get(code);
    if (alreadyCreated) return { id: alreadyCreated };

    const row = codeToRow.get(code);
    if (!row) {
      throw new BadRequestException(
        `Parent Account Code "${code}" not found — no account with that code exists in the Chart of Accounts or elsewhere in this file.`,
      );
    }

    if (resolving.has(code)) {
      throw new BadRequestException(
        `Circular Parent Account Code reference detected at code "${code}".`,
      );
    }
    resolving.add(code);

    const accountType = row.accountType?.trim().toUpperCase();
    if (
      !accountType ||
      !Object.values(AccountType).includes(accountType as AccountType)
    ) {
      throw new BadRequestException(
        `Invalid account type "${row.accountType}" — expected one of ${Object.values(AccountType).join(', ')}.`,
      );
    }

    const kind = parseAccountKind(row.accountKind);
    if (!kind) {
      throw new BadRequestException(
        `Account Kind is required — expected ${ACCOUNT_KIND.POSTING} or ${ACCOUNT_KIND.AGGREGATION}.`,
      );
    }

    const parentAccountId = await this.resolveParentId(
      row.parentAccountCode,
      codeToRow,
      createdByCode,
      resolving,
      userId,
      options,
      accountType as AccountType,
      code,
    );
    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      row.currencyCode,
      'Currency Code',
    );

    const cache = getReferenceCache();
    const existingByCode = cache?.get(EXISTING_BY_CODE_KEY) as
      Map<string, string> | undefined;
    const existingId = existingByCode?.get(code);

    if (options?.dryRun) {
      const simulatedId = existingId ?? `dry-run:${code}`;
      createdByCode.set(code, simulatedId);
      resolving.delete(code);
      return { id: simulatedId };
    }

    if (existingId) {
      const updated = await this.chartOfAccountsService.update(
        existingId,
        {
          name: row.name,
          accountType: accountType as AccountType,
          parentAccountId,
          currencyId,
          allowReconciliation: parseBoolean(row.allowReconciliation),
          description: row.description || undefined,
          allowsPosting: kind === ACCOUNT_KIND.POSTING,
        },
        userId,
      );
      createdByCode.set(code, updated.id);
      resolving.delete(code);
      return { id: updated.id };
    }

    const account = await this.chartOfAccountsService.create(
      {
        codeOverride: code,
        name: row.name,
        accountType: accountType as AccountType,
        parentAccountId,
        currencyId,
        allowReconciliation: parseBoolean(row.allowReconciliation),
        description: row.description || undefined,
        allowsPosting: kind === ACCOUNT_KIND.POSTING,
      },
      userId,
    );
    createdByCode.set(code, account.id);
    if (existingByCode) existingByCode.set(code, account.id);
    resolving.delete(code);
    return { id: account.id };
  }

  private async resolveParentId(
    parentAccountCode: string | undefined,
    codeToRow: Map<string, Record<string, string>>,
    createdByCode: Map<string, string>,
    resolving: Set<string>,
    userId: string | undefined,
    options: ImportRowOptions | undefined,
    accountType: AccountType,
    childCode: string,
  ): Promise<string | undefined> {
    const trimmed = parentAccountCode?.trim();
    if (!trimmed) {
      if (childCode === ROOT_CODE_BY_ACCOUNT_TYPE[accountType]) {
        return undefined;
      }
      const root =
        await this.chartOfAccountsService.ensureSystemRoot(accountType);
      return root.id;
    }

    const createdId = createdByCode.get(trimmed);
    if (createdId) return createdId;

    const cache = getReferenceCache();
    const existingByCode = cache?.get(EXISTING_BY_CODE_KEY) as
      Map<string, string> | undefined;
    const existingId = existingByCode?.get(trimmed);
    if (existingId) return existingId;

    if (codeToRow.has(trimmed)) {
      const result = await this.upsertAccountForCode(
        trimmed,
        codeToRow,
        createdByCode,
        resolving,
        userId,
        options,
      );
      return result.id;
    }

    if (!cache) {
      const found = await this.prisma.chartOfAccount.findFirst({
        where: { code: trimmed, deletedAt: null },
        select: { id: true },
      });
      if (found) return found.id;
    }

    throw new BadRequestException({
      code: 'MASTER_DATA_NOT_FOUND',
      message: `Parent Account Code "${trimmed}" is not a recognized Chart of Account — choose an existing account code instead of typing a new one.`,
      field: 'Parent Account Code',
    });
  }
}
