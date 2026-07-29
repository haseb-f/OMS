import { Controller, Get, Param } from '@nestjs/common';
import { PaymentNotesService } from './payment-notes.service';

/** GET only here — creation goes through PaymentsController's "Add Note" operation. */
@Controller('payments/:paymentId/notes')
export class PaymentNotesController {
  constructor(private readonly paymentNotesService: PaymentNotesService) {}

  @Get()
  findAll(@Param('paymentId') paymentId: string) {
    return this.paymentNotesService.findAllForPayment(paymentId);
  }
}
