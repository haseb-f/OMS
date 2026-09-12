import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LeadSource, WorkflowType } from '@prisma/client';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { LeadsService } from '../leads.service';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import {
  LeadImportResult,
  LeadImportService,
} from './interfaces/lead-import.interface';

/**
 * Excel Lead import — same idempotency as Import Center (`LeadsImportHandler`).
 * Production Excel uploads should prefer Import Center; this covers the
 * LeadImportService contract for programmatic callers.
 *
 * Performance (Phase 2/3 audit): duplicate detection, phone normalization,
 * numbering, and assignment/distribution stay exactly per-row (each
 * genuinely depends on the current DB state and on the rows processed
 * before it) — nothing about their outcome changes here. What batches
 * safely, because it's constant for the whole run: the default LEAD
 * workflow status (resolved once, not once per row) and the "does this
 * externalOrderId already exist" idempotency pre-check (one query for
 * every id in the file instead of one per row).
 */
@Injectable()
export class ExcelImportService implements LeadImportService {
  constructor(
    @Inject(forwardRef(() => LeadsService))
    private readonly leadsService: LeadsService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  parse(source: unknown): Promise<CreateLeadDto[]> {
    if (!Array.isArray(source)) {
      throw new Error('Excel Lead import expects an array of row DTOs.');
    }
    return Promise.resolve(source as CreateLeadDto[]);
  }

  async import(source: unknown): Promise<LeadImportResult> {
    const rows = await this.parse(source);
    const importBatch = `excel-${randomUUID()}`;
    let imported = 0;
    let skipped = 0;
    const errors: LeadImportResult['errors'] = [];

    const defaultStatusId = await this.workflowEngine.resolveDefaultStatusId(
      WorkflowType.LEAD,
    );
    const seenExternalIds =
      await this.leadsService.findExistingExternalOrderIds(
        rows
          .map((row) => row.externalOrderId)
          .filter((id): id is string => !!id),
      );

    for (let i = 0; i < rows.length; i++) {
      const row: CreateLeadDto = {
        ...rows[i],
        source: LeadSource.EXCEL,
        importBatch,
      };
      try {
        if (row.externalOrderId && seenExternalIds.has(row.externalOrderId)) {
          skipped += 1;
          continue;
        }
        await this.leadsService.create(row, undefined, {
          defaultStatusId,
          skipFullRefetch: true,
        });
        if (row.externalOrderId) seenExternalIds.add(row.externalOrderId);
        imported += 1;
      } catch (error) {
        errors.push({
          row: i + 1,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      importBatch,
      totalRows: rows.length,
      imported,
      skipped,
      errors,
    };
  }
}
