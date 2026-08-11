import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentActivitiesController } from './activities/payment-activities.controller';
import { PaymentActivityService } from './activities/payment-activity.service';
import { PaymentNotesController } from './notes/payment-notes.controller';
import { PaymentNotesService } from './notes/payment-notes.service';
import { PaymentAttachmentsController } from './attachments/payment-attachments.controller';
import { PaymentAttachmentsService } from './attachments/payment-attachments.service';
import { PaymentAutoMatchingService } from './auto-matching/payment-auto-matching.service';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [LeadsModule, StoreOrdersModule, NumberingModule],
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
  exports: [PaymentsService, PaymentAutoMatchingService],
})
export class PaymentsModule {}
