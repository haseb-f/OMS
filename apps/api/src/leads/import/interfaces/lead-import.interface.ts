import { CreateLeadDto } from '../../dto/create-lead.dto';

/**
 * Contract for future lead-import sources (Excel, Google Sheets). Only the
 * shape is prepared here — no source reads a real file/sheet yet.
 */
export interface LeadImportResult {
  importBatch: string;
  totalRows: number;
  imported: number;
  skipped: number;
  errors: LeadImportRowError[];
}

export interface LeadImportRowError {
  row: number;
  message: string;
}

export interface LeadImportService {
  /**
   * Parses the given source into lead-creation payloads. Not implemented in
   * this phase.
   */
  parse(source: unknown): Promise<CreateLeadDto[]>;

  /**
   * Parses and imports leads in one step, tagging them with a shared
   * importBatch. Not implemented in this phase.
   */
  import(source: unknown): Promise<LeadImportResult>;
}
