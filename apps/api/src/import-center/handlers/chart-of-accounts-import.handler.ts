import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChartOfAccountsService } from '../../chart-of-accounts/chart-of-accounts.service';
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

const CODE_TO_ROW_KEY = 'ChartOfAccountsImport:codeToRow';
const EXISTING_BY_CODE_KEY = 'ChartOfAccountsImport:existingByCode';
const CREATED_BY_CODE_KEY = 'ChartOfAccountsImport:createdByCode';

/**
 * Chart of Accounts Import — Parent Account Code hierarchy fix
 * (2026-08-15). Root cause of the original bug: the generic per-run
 * Master-Data cache (`import-value.util.ts`'s `fetchAllItems`, backing
 * `resolveOptionalIdByField`) snapshots `ChartOfAccountsService.findAll()`
 * ONCE per import run and never refreshes — so a child row whose parent was
 * created moments earlier IN THE SAME RUN (the overwhelming majority of
 * rows in any real multi-level file) could never be found, and got
 * silently truncated across repeated re-imports. Fixed here by resolving
 * `parentAccountCode` through a dedicated, per-run, INCREMENTALLY-UPDATED
 * map instead — never through the generic cache (`currencyCode` still
 * uses it unchanged, since Currency rows are never created mid-run).
 *
 * Algorithm (spec's Phase 1-4), implemented via the existing
 * `preloadRows`/`importRow` extension points — no second import engine, no
 * `groupKey`/grouped-rows mechanism, nothing added to `ImportJobsService`:
 *
 * Phase 1/2 — `preloadRows()` reads every row in the file once, builds
 * `code -> row` (the WHOLE file, so a forward reference to a not-yet-
 * processed row is resolvable) and `code -> existing DB id` (one query, no
 * N+1) into the job-scoped cache (`reference-cache.ts` — the exact same
 * `AsyncLocalStorage` scoping `ImportJobsService.validate()`/`run()`
 * already wrap every row in, so this state never leaks across two
 * different import jobs).
 *
 * Phase 3/4 — `importRow()` resolves a parent by trying, in order: (a)
 * already created earlier in this run, (b) already existing in the
 * database, (c) defined elsewhere in this file but not yet created — in
 * which case it's created FIRST, recursively (so parent-after-child in the
 * file works identically to parent-before-child), and only then does the
 * current row get created with that real `parentAccountId`. A code found
 * in none of the three throws a clear, actionable rejection — never a
 * guess, never a fallback parent. A row the engine later revisits (because
 * it was already created as a side effect of resolving an earlier row's
 * parent) is detected via the same map and returns the existing id without
 * re-creating anything.
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
    private readonly prisma: PrismaService,
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly currenciesService: CurrenciesService,
    private readonly registry: ImportTypeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  /** Phase 1/2 — one read of the whole file + one existing-accounts query, cached for every row's parent resolution in this run. */
  async preloadRows(rows: Record<string, string>[]): Promise<void> {
    const cache = getReferenceCache();
    if (!cache) return; // no active job context (e.g. a direct unit-test call) — importRow falls back to live per-call resolution below.

    const codeToRow = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const code = row.code?.trim();
      if (code) codeToRow.set(code, row);
    }
    cache.set(CODE_TO_ROW_KEY, codeToRow);

    const existing = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true },
    });
    cache.set(
      EXISTING_BY_CODE_KEY,
      new Map(existing.map((a) => [a.code, a.id])),
    );

    cache.set(CREATED_BY_CODE_KEY, new Map<string, string>());
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
      // Fallback path (no job context): this single row is the entire
      // known file — a forward reference elsewhere in a real file can't
      // be resolved here, only an already-existing DB account can.
      const codeToRow = new Map([[code, row]]);
      return this.createAccountForCode(
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
    return this.createAccountForCode(
      code,
      codeToRow,
      createdByCode,
      new Set(),
      userId,
      options,
    );
  }

  /** Resolves (creating on demand if needed) the account for `code`, recursing into its own parent first — the actual Phase 3/4 dependency-safe creation. `resolving` detects a circular Parent Account Code chain. */
  private async createAccountForCode(
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

    const parentAccountId = await this.resolveParentId(
      row.parentAccountCode,
      codeToRow,
      createdByCode,
      resolving,
      userId,
      options,
    );
    const currencyId = await resolveOptionalIdByField(
      this.currenciesService,
      'code',
      row.currencyCode,
      'Currency Code',
    );

    if (options?.dryRun) {
      // Simulated id, unique per code — so a later row in the SAME dry-run
      // pass that references this code as its own parent still resolves
      // consistently, without ever writing to the database.
      const simulatedId = `dry-run:${code}`;
      createdByCode.set(code, simulatedId);
      resolving.delete(code);
      return { id: simulatedId };
    }

    const account = await this.chartOfAccountsService.create(
      {
        // Bulk-importing a chart of accounts is itself a privileged setup
        // operation (Part 12) — every imported row's explicit code goes
        // through the same `codeOverride` gate a manual override would,
        // never a silent bypass just because it came from a spreadsheet.
        codeOverride: code,
        name: row.name,
        accountType: accountType as AccountType,
        parentAccountId,
        currencyId,
        allowReconciliation: parseBoolean(row.allowReconciliation),
        description: row.description || undefined,
      },
      userId,
    );
    createdByCode.set(code, account.id);
    resolving.delete(code);
    return { id: account.id };
  }

  /**
   * Parent Account Code is the single authoritative source (spec) —
   * resolved in this exact order, never inferred any other way: already
   * created earlier in this run, already existing in the database, or
   * defined elsewhere in this same file (created now, recursively). A code
   * matching none of the three is a hard rejection, never a silent
   * fallback.
   */
  private async resolveParentId(
    parentAccountCode: string | undefined,
    codeToRow: Map<string, Record<string, string>>,
    createdByCode: Map<string, string>,
    resolving: Set<string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<string | undefined> {
    const trimmed = parentAccountCode?.trim();
    if (!trimmed) return undefined;

    const createdId = createdByCode.get(trimmed);
    if (createdId) return createdId;

    const cache = getReferenceCache();
    const existingByCode = cache?.get(EXISTING_BY_CODE_KEY) as
      Map<string, string> | undefined;
    const existingId = existingByCode?.get(trimmed);
    if (existingId) return existingId;

    if (codeToRow.has(trimmed)) {
      const result = await this.createAccountForCode(
        trimmed,
        codeToRow,
        createdByCode,
        resolving,
        userId,
        options,
      );
      return result.id;
    }

    // No preload (fallback path) — one live, always-current lookup rather
    // than trusting a possibly-stale generic cache.
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
