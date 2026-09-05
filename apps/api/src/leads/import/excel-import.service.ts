import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LeadSource } from '@prisma/client';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { LeadsService } from '../leads.service';
import {
  LeadImportResult,
  LeadImportService,
} from './interfaces/lead-import.interface';

/**
 * Excel Lead import — same idempotency as Import Center (`LeadsImportHandler`).
 * Production Excel uploads should prefer Import Center; this covers the
 * LeadImportService contract for programmatic callers.
 */
@Injectable()
export class ExcelImportService implements LeadImportService {
  constructor(
    @Inject(forwardRef(() => LeadsService))
    private readonly leadsService: LeadsService,
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

    for (let i = 0; i < rows.length; i++) {
      const row: CreateLeadDto = {
        ...rows[i],
        source: LeadSource.EXCEL,
        importBatch,
      };
      try {
        if (row.externalOrderId) {
          const existing = await this.leadsService.findByExternalOrderId(
            row.externalOrderId,
          );
          if (existing) {
            skipped += 1;
            continue;
          }
        }
        await this.leadsService.create(row);
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
