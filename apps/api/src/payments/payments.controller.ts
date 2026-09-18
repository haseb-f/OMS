import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreatePaymentNoteDto } from './dto/create-payment-note.dto';
import { CreatePaymentAttachmentDto } from './dto/create-payment-attachment.dto';
import { ArchivePaymentAttachmentDto } from './dto/archive-payment-attachment.dto';
import { MatchPaymentDto } from './dto/match-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { FindPaymentsQueryDto } from './dto/find-payments-query.dto';
import { SetActualFeeDto } from './dto/set-actual-fee.dto';
import { ATTACHMENT_MAX_BYTES } from '../common/storage/file-validation';
import { AttachmentsService } from '../common/storage/attachments.service';

/**
 * Store-Order Payment rows (PENDING → MATCHED → VERIFIED). Distinct from
 * Customer Receipt vouchers (`/financial-transactions/receipts`), but the
 * match/verify/reject decisions are the same Finance confirmation gate
 * (`sales.receipts.confirm`). Attachment upload stays self-scoped to the
 * authenticated user via AttachmentsService — Sales Agents attach proof
 * after `report-payment` without holding Finance confirm.
 */
@Controller('payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customer-receipts')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindPaymentsQueryDto) {
    return this.paymentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Post(':id/match')
  @HttpCode(200)
  @PermissionAction('confirm')
  match(@Param('id') id: string, @Body() dto: MatchPaymentDto) {
    return this.paymentsService.match(id, dto);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @PermissionAction('confirm')
  verify(@Param('id') id: string, @Body() dto: VerifyPaymentDto) {
    return this.paymentsService.verify(id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @PermissionAction('confirm')
  reject(@Param('id') id: string, @Body() dto: RejectPaymentDto) {
    return this.paymentsService.reject(id, dto);
  }

  /**
   * ADR-0018 (M2.2) — the actual provider transaction fee, once known/
   * reconciled: a financial input, not just a view, so it needs its own
   * gate (`orders.profitability.editCosts`) rather than riding on this
   * controller's otherwise-ungated routes or on `profitability_view`.
   */
  @Post(':id/fee')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @PermissionModule('store-orders')
  @PermissionAction('profitability_edit_costs')
  setActualFee(
    @Param('id') id: string,
    @Body() dto: SetActualFeeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.setActualFee(id, dto.actualFeeAmount, user.sub);
  }

  @Post(':id/attachments/from-staging')
  @HttpCode(200)
  @SkipPermissionCheck()
  attachStaging(
    @Param('id') id: string,
    @Body() body: { stagingAttachmentIds?: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachments.attachStagingToPayment(
      id,
      body.stagingAttachmentIds ?? [],
      user.sub,
    );
  }

  @Post(':id/attachments/upload')
  @SkipPermissionCheck()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
    }),
  )
  uploadReceipt(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachments.uploadForPayment(id, file, user.sub);
  }

  @Post(':id/attachments/:attachmentId/archive')
  @HttpCode(200)
  @SkipPermissionCheck()
  archiveReceipt(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: ArchivePaymentAttachmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachments.archivePaymentAttachment(
      id,
      attachmentId,
      user.sub,
      dto.reason,
    );
  }

  @Post(':id/attachments')
  @SkipPermissionCheck()
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
  @SkipPermissionCheck()
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
