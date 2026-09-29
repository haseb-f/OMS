import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
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
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { StoreOrdersService } from './store-orders.service';
import { CreateStoreOrderDto } from './dto/create-store-order.dto';
import { UpdateStoreOrderDto } from './dto/update-store-order.dto';
import { SetStoreOrderLineAmountsDto } from './dto/set-line-amounts.dto';
import { FindStoreOrdersQueryDto } from './dto/find-store-orders-query.dto';
import { CreateStoreOrderNoteDto } from './dto/create-store-order-note.dto';
import { CreateStoreOrderPaymentDto } from './dto/create-store-order-payment.dto';
import { SetPaymentReviewStatusDto } from './dto/set-payment-review-status.dto';
import { ReportStoreOrderPaymentDto } from './dto/report-store-order-payment.dto';
import { CreateStoreOrderReceiptDto } from './dto/create-store-order-receipt.dto';
import { ATTACHMENT_MAX_BYTES } from '../common/storage/file-validation';
import { DeclareStoreOrderPaymentDto } from './dto/declare-store-order-payment.dto';
import { StoreOrderPaymentDeclarationService } from './payment-declaration/store-order-payment-declaration.service';

/** Recording pickup steps: store staff (`store-orders.edit`) or shipping staff (`shipping.edit`) — any-of. */
const PICKUP_PERMISSIONS = ['store-orders.edit', 'shipping.edit'] as const;

/**
 * Business operations, not generic CRUD — `update` is deliberately narrow
 * (see `UpdateStoreOrderDto`); every other mutation is a named operation.
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrdersController {
  constructor(
    private readonly storeOrdersService: StoreOrdersService,
    private readonly permissionsResolver: PermissionsResolverService,
    private readonly declarations: StoreOrderPaymentDeclarationService,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateStoreOrderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // An optional declaration on create needs the same any-of permission as
    // the standalone declaration endpoint.
    const declaration = dto.declaration;
    if (!declaration) return this.storeOrdersService.create(dto, user.sub);
    const actor = await this.declarations.resolveActor(user.sub);
    return this.storeOrdersService.create(dto, user.sub, (tx, orderId) =>
      this.declarations.declareInTx(
        tx,
        orderId,
        declaration,
        declaration.idempotencyKey,
        actor,
      ),
    );
  }

  @Get()
  async findAll(
    @Query() query: FindStoreOrdersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.findAll(
      query,
      user.sub,
      await this.resolveIncludeProfitability(query, user),
    );
  }

  /**
   * "Select all matching filters" — bare IDs only, same filter/search AND the
   * same profitability decision as `findAll`, so Cost State / Loss-Making
   * narrow the selection exactly as they narrow the list.
   */
  @Get('ids')
  async findAllIds(
    @Query() query: FindStoreOrdersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.findAllIds(
      query,
      user.sub,
      await this.resolveIncludeProfitability(query, user),
    );
  }

  /**
   * ADR-0018 (M2 gap closure, Part 22) — the permission decision happens
   * here, server-side, never trusted from `query.includeProfitability`
   * itself. An unauthorized caller gets ordinary Order rows with no
   * `profitability` field at all, not a hidden/empty one — and its
   * Cost State / Loss-Making params are ignored in both list and ids.
   */
  private async resolveIncludeProfitability(
    query: FindStoreOrdersQueryDto,
    user: JwtPayload,
  ): Promise<boolean> {
    return (
      !!query.includeProfitability &&
      (await this.permissionsResolver.hasPermission(
        user.sub,
        'orders.profitability.view',
      ))
    );
  }

  /**
   * Exact Order Number global lookup — gated by `orders.lookup_global`, not
   * ordinary own-scope. Static route — must precede `:id`.
   */
  @Get('global-lookup')
  @PermissionAction('lookup_global')
  globalLookupByOrderNumber(
    @Query('orderNumber') orderNumber: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.globalLookupByOrderNumber(
      orderNumber,
      user.sub,
    );
  }

  @Get(':id/payment-context')
  paymentContext(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.storeOrdersService.paymentContext(id, user.sub);
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

  /** Pricing correction — only before any invoice or verified payment. */
  @Post(':id/line-amounts')
  @HttpCode(200)
  @PermissionAction('edit')
  setLineAmounts(
    @Param('id') id: string,
    @Body() dto: SetStoreOrderLineAmountsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.setLineAmounts(id, dto, user.sub);
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

  /**
   * Finance-only voucher-style claim (receiving account chosen). Sales no
   * longer registers payments this way — it declares them through
   * `POST :id/payment-declaration` (payment-declaration-reconciliation).
   */
  @Post(':id/payments')
  @PermissionModule('customer-receipts')
  @PermissionAction('create')
  addPayment(
    @Param('id') id: string,
    @Body() dto: CreateStoreOrderPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.addPayment(id, dto, user.sub);
  }

  /**
   * Legacy payment report (free amount + receiving account). Superseded for
   * Sales by `POST :id/payment-declaration`; kept for Finance callers only.
   */
  @Post(':id/report-payment')
  @PermissionModule('customer-receipts')
  @PermissionAction('create')
  reportPayment(
    @Param('id') id: string,
    @Body() dto: ReportStoreOrderPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeOrdersService.reportPayment(id, dto, user.sub);
  }

  /**
   * Sales/Finance payment declaration (Unpaid / Paid in full / Partially
   * paid). Creates at most one unverified claim per idempotency key and no
   * accounting entries. Permission: `store-orders.edit` OR
   * `sales.receipts.create` (any-of, checked in the service — the guard
   * maps one route to one permission).
   */
  @Post(':id/payment-declaration')
  @HttpCode(200)
  @SkipPermissionCheck()
  async declarePayment(
    @Param('id') id: string,
    @Body() dto: DeclareStoreOrderPaymentDto,
    @CurrentUser() user: JwtPayload,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    const actor = await this.declarations.resolveActor(user.sub);
    await this.storeOrdersService.findOne(id, user.sub);
    const result = await this.declarations.declare(
      id,
      dto,
      dto.idempotencyKey ?? headerKey ?? '',
      actor,
    );
    return {
      ...result,
      order: await this.storeOrdersService.findOne(id, user.sub),
    };
  }

  @Get(':id/can-fulfill')
  canFulfill(@Param('id') id: string) {
    return this.storeOrdersService.canFulfill(id);
  }

  @Post(':id/pickup/:code')
  @HttpCode(200)
  @SkipPermissionCheck()
  async transitionPickup(
    @Param('id') id: string,
    @Param('code')
    code: 'READY_FOR_PICKUP' | 'COLLECTED' | 'CANCELLED' | 'RETURNED',
    @CurrentUser() user: JwtPayload,
  ) {
    const allowed = await Promise.all(
      PICKUP_PERMISSIONS.map((name) =>
        this.permissionsResolver.hasPermission(user.sub, name),
      ),
    );
    if (!allowed.some(Boolean)) {
      throw new ForbiddenException(
        'Missing permission "store-orders.edit" or "shipping.edit" to record pickup steps.',
      );
    }
    return this.storeOrdersService.transitionPickup(id, code, user.sub);
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
  @PermissionAction('generate_invoice')
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
    @Body('paymentId') paymentId?: string,
  ) {
    return this.storeOrdersService.uploadReceipt(id, file, user.sub, paymentId);
  }

  @Get(':id/receipts/:receiptId/file')
  async downloadReceipt(
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const file = await this.storeOrdersService.getReceiptFile(
      id,
      receiptId,
      user.sub,
    );
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
