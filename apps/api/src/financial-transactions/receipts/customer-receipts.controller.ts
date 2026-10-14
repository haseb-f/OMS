import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FinancialTransactionType } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import {
  CurrentCompanyContext,
  type CompanyContext,
} from '../../common/decorators/current-company-context.decorator';
import { FinancialTransactionsService } from '../financial-transactions.service';
import { AllocationInputDto } from '../shared/allocation-input.dto';
import { UpdateAllocationDto } from '../shared/update-allocation.dto';
import { CreateCustomerReceiptDto } from './dto/create-customer-receipt.dto';
import { UpdateCustomerReceiptDto } from './dto/update-customer-receipt.dto';
import { FindCustomerReceiptsQueryDto } from './dto/find-customer-receipts-query.dto';

const TYPE = FinancialTransactionType.CUSTOMER_RECEIPT;

/** Business operations only: Create, Update, Confirm, Cancel, Archive, Allocate, Unallocate, Search, Open Invoices, Details. */
@Controller('financial-transactions/receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customer-receipts')
export class CustomerReceiptsController {
  constructor(private readonly transactions: FinancialTransactionsService) {}

  @Post()
  create(
    @Body() dto: CreateCustomerReceiptDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.create(TYPE, dto, user.sub, context);
  }

  /**
   * Create + Confirm + Post in ONE database transaction — used by "Confirm"
   * on a not-yet-saved voucher, so a posting failure never leaves an orphan
   * Draft behind (and a retry never piles up duplicate Drafts).
   */
  @Post('confirmed')
  @PermissionAction('confirm')
  createConfirmed(
    @Body() dto: CreateCustomerReceiptDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.transactions.createConfirmed(TYPE, dto, user.sub, context);
  }

  @Get()
  findAll(@Query() query: FindCustomerReceiptsQueryDto) {
    return this.transactions.findAll(TYPE, query);
  }

  /** Open Sales Invoices for the Allocation Grid / "Pay All Remaining" — must be registered before `:id`. */
  @Get('open-invoices')
  getOpenInvoices(@Query('partnerId') partnerId: string) {
    return this.transactions.getOpenInvoices(TYPE, partnerId);
  }

  /** R20 — the customer's payment position per currency (outstanding / received / applied / unapplied) — before `:id`. */
  @Get('position')
  getPartyPosition(@Query('partnerId') partnerId: string) {
    return this.transactions.getPartyPosition(TYPE, partnerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactions.findOne(TYPE, id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerReceiptDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.remove(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  async confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.cancel(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  async archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.archive(id, user.sub);
  }

  /** Allocation is saved by the voucher editor — `edit` (SEC-03 H2 audit). */
  @Post(':id/allocate')
  @HttpCode(200)
  @PermissionAction('edit')
  async allocate(
    @Param('id') id: string,
    @Body() dto: AllocationInputDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.allocate(id, dto, user.sub);
  }

  /**
   * R22 contract 3 — changes one line's amount atomically (same guards as
   * Allocate, no new cash entry); a refused change keeps the old line.
   */
  @Patch(':id/allocations/:allocationId')
  @PermissionAction('edit')
  async updateAllocation(
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
    @Body() dto: UpdateAllocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.updateAllocation(
      id,
      allocationId,
      dto.allocatedAmount,
      user.sub,
    );
  }

  @Post(':id/allocations/:allocationId/unallocate')
  @HttpCode(200)
  @PermissionAction('edit')
  async unallocate(
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.transactions.assertRouteType(TYPE, id);
    return this.transactions.unallocate(id, allocationId, user.sub);
  }
}
