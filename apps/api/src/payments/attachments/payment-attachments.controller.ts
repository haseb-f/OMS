import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { AttachmentsService } from '../../common/storage/attachments.service';

/** GET only here — creation goes through PaymentsController upload/attach. */
@Controller('payments/:paymentId/attachments')
@UseGuards(JwtAuthGuard)
export class PaymentAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  findAll(
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachments.listForPayment(paymentId, user.sub);
  }
}
