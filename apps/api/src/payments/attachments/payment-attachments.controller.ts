import { Controller, Get, Param } from '@nestjs/common';
import { PaymentAttachmentsService } from './payment-attachments.service';

/** GET only here — creation goes through PaymentsController's "Attach Receipt" operation. */
@Controller('payments/:paymentId/attachments')
export class PaymentAttachmentsController {
  constructor(
    private readonly paymentAttachmentsService: PaymentAttachmentsService,
  ) {}

  @Get()
  findAll(@Param('paymentId') paymentId: string) {
    return this.paymentAttachmentsService.findAllForPayment(paymentId);
  }
}
