import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateLeadDto } from '../dto/create-lead.dto';
import {
  LeadImportResult,
  LeadImportService,
} from './interfaces/lead-import.interface';

/**
 * Architecture placeholder only. Excel import itself is out of scope for
 * this phase — see TASK-008 "IMPORT: Prepare architecture only."
 */
@Injectable()
export class ExcelImportService implements LeadImportService {
  parse(source: unknown): Promise<CreateLeadDto[]> {
    void source;
    throw new NotImplementedException('Excel import is not implemented yet.');
  }

  import(source: unknown): Promise<LeadImportResult> {
    void source;
    throw new NotImplementedException('Excel import is not implemented yet.');
  }
}
