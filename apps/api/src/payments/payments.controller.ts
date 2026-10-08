import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { DisputePaymentDto } from './dto/dispute-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { FindPaymentsQueryDto } from './dto/find-payments-query.dto';
import { SetActualFeeDto } from './dto/set-actual-fee.dto';
import {
  BulkConfirmPaymentsDto,
  BulkRejectPaymentsDto,
} from './dto/bulk-payment-action.dto';
import { PaymentReviewService } from './payment-review.service';
import { PaymentsBulkService } from './payments-bulk.service';
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
    private readonly review: PaymentReviewService,
    private readonly bulk: PaymentsBulkService,
  ) {}

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindPaymentsQueryDto) {
    return this.paymentsService.findAll(query);
  }

  // Static routes are declared BEFORE the `:id` routes on purpose: Express
  // matches in registration order, so `review-summary` / `bulk` never reach
  // `GET :id` / `POST :id/confirm` / `POST :id/reject` as an id.

  /** Payments review stage strip: counts + amounts per currency (statement stages only with reconciliation view). */
  @Get('review-summary')
  @PermissionAction('view')
  reviewSummary(@CurrentUser() user: JwtPayload) {
    return this.review.summary(user.sub);
  }

  /** Bulk Confirm & Post — each id through `confirm` in its own transaction; per-item results. */
  @Post('bulk/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  bulkConfirm(
    @Body() dto: BulkConfirmPaymentsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulk.confirmMany(dto.ids, user.sub);
  }

  /** Bulk reject declarations with one shared reason — each id through `reject`. */
  @Post('bulk/reject')
  @HttpCode(200)
  @PermissionAction('confirm')
  bulkReject(
    @Body() dto: BulkRejectPaymentsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulk.rejectMany(dto.ids, dto.rejectionReason, user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  /** Match panel — the declaration side (order, customer, evidence, debit account, receipt/JE). */
  @Get(':id/review-context')
  @PermissionAction('view')
  reviewContext(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.context(id);
  }

  @Post(':id/match')
  @HttpCode(200)
  @PermissionAction('confirm')
  match(@Param('id') id: string, @Body() dto: MatchPaymentDto) {
    return this.paymentsService.match(id, dto);
  }

  /**
   * Confirm & Post — the single Finance decision: validates, verifies and
   * posts the Customer Receipt + Journal Entry atomically. Idempotent.
   */
  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.confirm(id, user.sub);
  }

  /** Legacy alias of Confirm & Post (kept for existing API clients). */
  @Post(':id/verify')
  @HttpCode(200)
  @PermissionAction('confirm')
  verify(
    @Param('id') id: string,
    @Body() _dto: VerifyPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.confirm(id, user.sub);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @PermissionAction('confirm')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.reject(id, { ...dto, rejectedById: user.sub });
  }

  /** Finance disputes a Sales declaration (reason required); flags the order if already fulfilled. */
  @Post(':id/dispute')
  @HttpCode(200)
  @PermissionAction('confirm')
  dispute(
    @Param('id') id: string,
    @Body() dto: DisputePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.dispute(id, user.sub, dto.reason);
  }

  /**
   * R15 (D15-12) — audited reversal of a VERIFIED payment recorded in error:
   * its receipt is reversed by a reversing entry, the payment becomes
   * REVERSED (reason kept); never a deletion.
   */
  @Post(':id/reverse')
  @HttpCode(200)
  @PermissionAction('reverse')
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.reverse(id, dto.reason, user.sub);
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
  async attachReceipt(
    @Param('id') id: string,
    @Body() dto: CreatePaymentAttachmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // SEC-03: same evidence scope as the upload path, and the author is
    // always the caller — never a client-supplied user id.
    await this.attachments.assertCanMutatePaymentEvidence(id, user.sub);
    return this.paymentsService.attachReceipt(id, {
      ...dto,
      uploadedById: user.sub,
      attachmentType: dto.attachmentType ?? 'RECEIPT',
    });
  }

  @Post(':id/notes')
  @SkipPermissionCheck()
  async addNote(
    @Param('id') id: string,
    @Body() dto: CreatePaymentNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.attachments.assertCanMutatePaymentEvidence(id, user.sub);
    return this.paymentsService.addNote(id, {
      ...dto,
      userId: user.sub,
    });
  }
}
