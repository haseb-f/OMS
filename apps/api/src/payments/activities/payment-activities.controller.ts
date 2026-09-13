import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PaymentActivityService } from './payment-activity.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Business operation: View Timeline. Read-only — activities are system-generated. */
@Controller('payments/:paymentId/activities')
@UseGuards(JwtAuthGuard)
export class PaymentActivitiesController {
  constructor(
    private readonly paymentActivityService: PaymentActivityService,
  ) {}

  @Get()
  findAll(@Param('paymentId') paymentId: string) {
    return this.paymentActivityService.findAllForPayment(paymentId);
  }
}
