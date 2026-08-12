import { Injectable, OnModuleInit } from '@nestjs/common';
import { JournalEntriesService } from '../../journal-entries/journal-entries.service';
import { JournalsService } from '../../journals/journals.service';
import { ChartOfAccountsService } from '../../chart-of-accounts/chart-of-accounts.service';
import { CostCentersService } from '../../cost-centers/cost-centers.service';
import { ProjectsService } from '../../projects/projects.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import {
  resolveOptionalIdByField,
  resolveRequiredIdByField,
} from '../import-value.util';
import { parseOptionalNumber } from './document-line.util';
import type {
  ImportFieldDef,
  ImportRowOptions,
  ImportRowResult,
  ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'documentNumber',
    labelKey: 'importCenter.fields.documentNumber',
    label: 'Document Number',
    required: true,
    type: 'string',
    example: 'Groups multiple rows into one Journal Entry',
  },
  {
    key: 'entryDate',
    labelKey: 'importCenter.fields.entryDate',
    label: 'Entry Date',
    required: true,
    type: 'date',
  },
  {
    key: 'journalCode',
    labelKey: 'importCenter.fields.journalCode',
    label: 'Journal Code',
    required: true,
    type: 'string',
    example: 'GJ',
    referenceType: 'JOURNAL',
    referenceMatchField: 'code',
  },
  {
    key: 'referenceNumber',
    labelKey: 'importCenter.fields.referenceNumber',
    label: 'Reference Number',
    required: false,
    type: 'string',
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
  {
    key: 'costCenterCode',
    labelKey: 'importCenter.fields.costCenterCode',
    label: 'Cost Center Code',
    required: false,
    type: 'string',
    referenceType: 'COST_CENTER',
    referenceMatchField: 'code',
  },
  {
    key: 'projectCode',
    labelKey: 'importCenter.fields.projectCode',
    label: 'Project Code',
    required: false,
    type: 'string',
    referenceType: 'PROJECT',
    referenceMatchField: 'code',
  },
];

/**
 * Journal Entries Import (TASK-059) — every group of rows sharing
 * `documentNumber` becomes one `JournalEntriesService.create()` call, so
 * balance validation (`assertBalanced`), period checks, and numbering all
 * run exactly as they do for a manually typed entry. Never posts on import —
 * imported entries land as Draft; Post stays a deliberate manual action
 * (Chief Accountant Guardian: "Never create Journal Entries manually" refers
 * to bypassing this service, not to this Draft-only import step).
 */
@Injectable()
export class JournalEntriesImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'MANUAL_JOURNAL_ENTRIES';
  readonly labelKey = 'importCenter.types.manualJournalEntries.label';
  readonly descriptionKey =
    'importCenter.types.manualJournalEntries.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'documentNumber';

  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly journalsService: JournalsService,
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly costCentersService: CostCentersService,
    private readonly projectsService: ProjectsService,
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
    const journalId = await resolveRequiredIdByField(
      this.journalsService,
      'code',
      first.journalCode,
      'Journal',
    );

    const lines = await Promise.all(
      rows.map(async (row) => {
        const accountId = await resolveRequiredIdByField(
          this.chartOfAccountsService,
          'code',
          row.accountCode,
          'Account',
        );
        const costCenterId = await resolveOptionalIdByField(
          this.costCentersService,
          'code',
          row.costCenterCode,
          'Cost Center',
        );
        const projectId = await resolveOptionalIdByField(
          this.projectsService,
          'code',
          row.projectCode,
          'Project',
        );
        return {
          accountId,
          description: row.description || undefined,
          costCenterId,
          projectId,
          debit: parseOptionalNumber(row.debit),
          credit: parseOptionalNumber(row.credit),
        };
      }),
    );

    if (options?.dryRun) return { id: 'dry-run' };

    const entry = await this.journalEntriesService.create(
      {
        entryDate: first.entryDate || undefined,
        journalId,
        referenceNumber: first.referenceNumber || undefined,
        description: first.description || undefined,
        lines,
      },
      userId,
    );
    return { id: entry.id };
  }
}
