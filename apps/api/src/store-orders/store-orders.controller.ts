import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { CreateStoreOrderReceiptDto } from './dto/create-store-order-receipt.dto';

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
  findAll(@Query() query: FindStoreOrdersQueryDto) {
    return this.storeOrdersService.findAll(query);
  }

  /** "Select all matching filters" — bare IDs only, same filter/search as `findAll`. */
  @Get('ids')
  findAllIds(@Query() query: FindStoreOrdersQueryDto) {
    return this.storeOrdersService.findAllIds(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.storeOrdersService.findOne(id);
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
