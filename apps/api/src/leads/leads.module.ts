import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadActivitiesController } from './activities/lead-activities.controller';
import { LeadActivityService } from './activities/lead-activity.service';
import { LeadAssignmentsController } from './assignments/lead-assignments.controller';
import { LeadAssignmentsService } from './assignments/lead-assignments.service';
import { LeadNotesController } from './notes/lead-notes.controller';
import { LeadNotesService } from './notes/lead-notes.service';
import { LeadImportModule } from './import/lead-import.module';
import { LeadDuplicateDetectionService } from './duplicate-detection/lead-duplicate-detection.service';
import { LeadAutoDistributionService } from './distribution/lead-auto-distribution.service';
import { NumberingModule } from '../numbering/numbering.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [LeadImportModule, NumberingModule, CustomersModule],
  controllers: [
    LeadsController,
    LeadActivitiesController,
    LeadAssignmentsController,
    LeadNotesController,
  ],
  providers: [
    LeadsService,
    LeadActivityService,
    LeadAssignmentsService,
    LeadNotesService,
    LeadDuplicateDetectionService,
    LeadAutoDistributionService,
  ],
  exports: [LeadsService, LeadAutoDistributionService],
})
export class LeadsModule {}
