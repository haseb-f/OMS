import { Module } from '@nestjs/common';
import { ExcelImportService } from './excel-import.service';
import { GoogleSheetsImportService } from './google-sheets-import.service';

/**
 * Provides the (currently stubbed) lead-import services so a future
 * ImportController can wire them in without redesigning this module.
 */
@Module({
  providers: [ExcelImportService, GoogleSheetsImportService],
  exports: [ExcelImportService, GoogleSheetsImportService],
})
export class LeadImportModule {}
