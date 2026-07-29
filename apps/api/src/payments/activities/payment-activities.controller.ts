import { Controller, Get, Param } from '@nestjs/common';
import { PaymentActivityService } from './payment-activity.service';

/** Business operation: View Timeline. Read-only — activities are system-generated. */
@Controller('payments/:paymentId/activities')
export class PaymentActivitiesController {
  constructor(
    private readonly paymentActivityService: PaymentActivityService,
  ) {}

  @Get()
  findAll(@Param('paymentId') paymentId: string) {
    return this.paymentActivityService.findAllForPayment(paymentId);
  }
}
