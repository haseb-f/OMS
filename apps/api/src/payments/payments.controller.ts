import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreatePaymentNoteDto } from './dto/create-payment-note.dto';
import { CreatePaymentAttachmentDto } from './dto/create-payment-attachment.dto';
import { MatchPaymentDto } from './dto/match-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';

/**
 * Business operations, not generic CRUD. Creation via "Create Payment" only.
 * No generic PATCH — every mutation is one of the named operations below.
 * No delete endpoint — not in the required operations list.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Get()
  findAll() {
    return this.paymentsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Post(':id/match')
  @HttpCode(200)
  match(@Param('id') id: string, @Body() dto: MatchPaymentDto) {
    return this.paymentsService.match(id, dto);
  }

  @Post(':id/verify')
  @HttpCode(200)
  verify(@Param('id') id: string, @Body() dto: VerifyPaymentDto) {
    return this.paymentsService.verify(id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: RejectPaymentDto) {
    return this.paymentsService.reject(id, dto);
  }

  @Post(':id/attachments')
  @UseGuards(JwtAuthGuard)
  attachReceipt(
    @Param('id') id: string,
    @Body() dto: CreatePaymentAttachmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.attachReceipt(id, {
      ...dto,
      uploadedById: dto.uploadedById ?? user.sub,
      attachmentType: dto.attachmentType ?? 'RECEIPT',
    });
  }

  @Post(':id/notes')
  @UseGuards(JwtAuthGuard)
  addNote(
    @Param('id') id: string,
    @Body() dto: CreatePaymentNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.addNote(id, {
      ...dto,
      userId: dto.userId ?? user.sub,
    });
  }
}
