import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { StoreOrdersService } from './store-orders.service';
import { CreateStoreOrderDto } from './dto/create-store-order.dto';
import { UpdateStoreOrderDto } from './dto/update-store-order.dto';
import { FindStoreOrdersQueryDto } from './dto/find-store-orders-query.dto';
import { CreateStoreOrderNoteDto } from './dto/create-store-order-note.dto';
import { CreateStoreOrderPaymentDto } from './dto/create-store-order-payment.dto';
import { SetPaymentReviewStatusDto } from './dto/set-payment-review-status.dto';
import { ReportStoreOrderPaymentDto } from './dto/report-store-order-payment.dto';
import { CreateStoreOrderReceiptDto } from './dto/create-store-order-receipt.dto';
import { ATTACHMENT_MAX_BYTES } from '../common/storage/file-validation';

/**
 * Business operations, not generic CRUD — `update` is deliberately narrow
 * (see `UpdateStoreOrderDto`); every other mutation is a named operation.
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrdersController {
  constructor(private readonly storeOrdersService: StoreOrdersService) {}

  @Post()
  create(@Body() dto: CreateStoreOrderDto, @CurrentUser() user: JwtPayload) {
    return this.storeOrdersService.create(dto, user.sub);
  }

  @Get()
  findAll(
    @Query() query: FindStoreOrdersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.findAll(query, user.sub);
  }

  /** "Select all matching filters" — bare IDs only, same filter/search as `findAll`. */
  @Get('ids')
  findAllIds(
    @Query() query: FindStoreOrdersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.findAllIds(query, user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.storeOrdersService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStoreOrderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.storeOrdersService.archive(id, user.sub);
  }

  @Post(':id/notes')
  @PermissionAction('edit')
  addNote(
    @Param('id') id: string,
    @Body() dto: CreateStoreOrderNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.addNote(id, dto, user.sub);
  }

  @Post(':id/payments')
  @PermissionAction('edit')
  addPayment(
    @Param('id') id: string,
    @Body() dto: CreateStoreOrderPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.addPayment(id, dto, user.sub);
  }

  /** Agent payment report — PAYMENT_REVIEW only; never PAID without reconciliation. */
  @Post(':id/report-payment')
  @PermissionAction('edit')
  reportPayment(
    @Param('id') id: string,
    @Body() dto: ReportStoreOrderPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.reportPayment(id, dto, user.sub);
  }

  @Get(':id/can-fulfill')
  canFulfill(@Param('id') id: string) {
    return this.storeOrdersService.canFulfill(id);
  }

  @Post(':id/payment-review-status')
  @HttpCode(200)
  @PermissionAction('manage')
  setPaymentReviewStatus(
    @Param('id') id: string,
    @Body() dto: SetPaymentReviewStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.setPaymentReviewStatus(id, dto, user.sub);
  }

  @Post(':id/generate-invoice')
  @HttpCode(200)
  @PermissionAction('edit')
  generateInvoice(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.storeOrdersService.generateInvoice(id, user.sub);
  }

  @Post(':id/receipts/upload')
  @PermissionAction('edit')
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
    return this.storeOrdersService.uploadReceipt(id, file, user.sub);
  }

  @Get(':id/receipts/:receiptId/file')
  async downloadReceipt(
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
  ) {
    const file = await this.storeOrdersService.getReceiptFile(id, receiptId);
    return new StreamableFile(file.body, {
      type: file.mimeType,
      disposition: `inline; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }

  @Post(':id/receipts/:receiptId/archive')
  @HttpCode(200)
  @PermissionAction('edit')
  archiveReceipt(
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.archiveReceipt(id, receiptId, user.sub);
  }

  @Post(':id/receipts')
  @PermissionAction('edit')
  addReceipt(
    @Param('id') id: string,
    @Body() dto: CreateStoreOrderReceiptDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.addReceipt(id, dto, user.sub);
  }
}
