import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpeningBalancesService } from '../../accounting/opening-balances/opening-balances.service';
import { ChartOfAccountsService } from '../../chart-of-accounts/chart-of-accounts.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { resolveRequiredIdByField } from '../import-value.util';
import { parseOptionalNumber } from './document-line.util';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'fiscalYearName',
    labelKey: 'importCenter.fields.fiscalYear',
    label: 'Fiscal Year',
    required: true,
    type: 'string',
    example: 'Groups multiple rows into one Fiscal Year’s Opening Balance',
  },
  {
    key: 'openingDate',
    labelKey: 'importCenter.fields.openingDate',
    label: 'Opening Date',
    required: true,
    type: 'date',
  },
  {
    key: 'accountCode',
    labelKey: 'importCenter.fields.accountCode',
    label: 'Account Code',
    required: true,
    type: 'string',
    referenceType: 'CHART_OF_ACCOUNT',
    referenceMatchField: 'code',
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
    key: 'description',
    labelKey: 'importCenter.fields.description',
    label: 'Description',
    required: false,
    type: 'string',
  },
];

/**
 * Opening Balances Import (TASK-059) — every group of rows sharing
 * `fiscalYearName` becomes one `OpeningBalancesService.create()` call, so
 * "one Opening Balance per Fiscal Year," the balance check, and the POSTED
 * JournalEntry it produces all run exactly as the manual Opening Balance
 * Wizard does. `fiscalYearName` is resolved with a direct read-only Prisma
 * lookup — `FiscalYearsService` has no generic by-name list method to reuse
 * (its own methods are id/date-keyed), the same "read-only lookup, no write
 * path" exception `FinancialTransactionsService` already takes for invoices.
 */
@Injectable()
export class OpeningBalancesImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'OPENING_BALANCES';
  readonly labelKey = 'importCenter.types.openingBalances.label';
  readonly descriptionKey = 'importCenter.types.openingBalances.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'fiscalYearName';

  constructor(
    private readonly prisma: PrismaService,
    private readonly openingBalancesService: OpeningBalancesService,
    private readonly chartOfAccountsService: ChartOfAccountsService,
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
    const fiscalYearName = first.fiscalYearName?.trim();
    if (!fiscalYearName) {
      throw new BadRequestException('Fiscal Year is required.');
    }
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: {
        name: { equals: fiscalYearName, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!fiscalYear) {
      throw new BadRequestException(
        `Fiscal Year "${fiscalYearName}" not found.`,
      );
    }
    if (!first.openingDate?.trim()) {
      throw new BadRequestException('Opening Date is required.');
    }

    const lines = await Promise.all(
      rows.map(async (row) => {
        const accountId = await resolveRequiredIdByField(
          this.chartOfAccountsService,
          'code',
          row.accountCode,
          'Account',
        );
        return {
          accountId,
          description: row.description || undefined,
          debit: parseOptionalNumber(row.debit),
          credit: parseOptionalNumber(row.credit),
        };
      }),
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const entry = await this.openingBalancesService.create(
      {
        fiscalYearId: fiscalYear.id,
        openingDate: first.openingDate,
        lines,
      },
      userId,
    );
    return { id: entry.id };
  }
}
