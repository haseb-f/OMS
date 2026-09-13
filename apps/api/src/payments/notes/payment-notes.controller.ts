import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PaymentNotesService } from './payment-notes.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** GET only here — creation goes through PaymentsController's "Add Note" operation. */
@Controller('payments/:paymentId/notes')
@UseGuards(JwtAuthGuard)
export class PaymentNotesController {
  constructor(private readonly paymentNotesService: PaymentNotesService) {}

  @Get()
  findAll(@Param('paymentId') paymentId: string) {
    return this.paymentNotesService.findAllForPayment(paymentId);
  }
}
