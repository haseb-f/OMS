import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentActivitiesController } from './activities/payment-activities.controller';
import { PaymentActivityService } from './activities/payment-activity.service';
import { PaymentNotesController } from './notes/payment-notes.controller';
import { PaymentNotesService } from './notes/payment-notes.service';
import { PaymentAttachmentsController } from './attachments/payment-attachments.controller';
import { PaymentAttachmentsService } from './attachments/payment-attachments.service';
import { PaymentAutoMatchingService } from './auto-matching/payment-auto-matching.service';

@Module({
  imports: [LeadsModule],
  controllers: [
    PaymentsController,
    PaymentActivitiesController,
    PaymentNotesController,
    PaymentAttachmentsController,
  ],
  providers: [
    PaymentsService,
    PaymentActivityService,
    PaymentNotesService,
    PaymentAttachmentsService,
    PaymentAutoMatchingService,
  ],
})
export class PaymentsModule {}
