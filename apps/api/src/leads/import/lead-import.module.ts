import { Module, forwardRef } from '@nestjs/common';
import { ExcelImportService } from './excel-import.service';
import { GoogleSheetsImportService } from './google-sheets-import.service';
import { LeadsModule } from '../leads.module';

/**
 * Lead import providers. Google Sheets + Excel share LeadsService idempotency
 * (externalOrderId). Production sheet/file pipelines prefer Import Center Sync.
 */
@Module({
  imports: [forwardRef(() => LeadsModule)],
  providers: [ExcelImportService, GoogleSheetsImportService],
  exports: [ExcelImportService, GoogleSheetsImportService],
})
export class LeadImportModule {}
