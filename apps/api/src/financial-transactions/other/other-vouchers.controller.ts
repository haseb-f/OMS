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
import { OtherVouchersService } from './other-vouchers.service';
import type { CounterVoucherType } from './other-voucher-types';
import {
  CounterAccountsQueryDto,
  CreateCounterVoucherDto,
  CreateTransferDto,
  FindOtherVouchersQueryDto,
  UpdateCounterVoucherDto,
  UpdateTransferDto,
} from './dto/other-voucher.dto';

/**
 * R22 (decision D4) — authorisation: the manual journal-entry permissions.
 * Whoever may create a manual journal entry can already post the same
 * Dr / Cr by hand, so `accounting.journal-entries.create` creates, edits,
 * confirms and cancels these vouchers, `accounting.journal-entries.view`
 * lists / reads them and `accounting.journal-entries.archive` deletes a
 * draft / archives a cancelled one. No new permission, no new grant.
 */
const JOURNAL_ENTRIES = 'journal-entries';

/** `GET financial-transactions/counter-accounts?direction=IN|OUT` — the counter-account allow-list. */
@Controller('financial-transactions/counter-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule(JOURNAL_ENTRIES)
export class CounterAccountsController {
  constructor(private readonly vouchers: OtherVouchersService) {}

  @Get()
  list(@Query() query: CounterAccountsQueryDto) {
    return this.vouchers.counterAccounts(query.direction);
  }
}

/**
 * Other receipt / other payment routes — the receipts controller shape
 * (list / get / create / createConfirmed / update / confirm / cancel /
 * archive / delete / activities). Subclasses only name the type and path.
 */
abstract class CounterVoucherRoutes {
  protected abstract readonly type: CounterVoucherType;

  constructor(protected readonly vouchers: OtherVouchersService) {}

  @Post()
  create(
    @Body() dto: CreateCounterVoucherDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.vouchers.create(this.type, dto, user.sub, context);
  }

  /** Create + Confirm + Post in one transaction, idempotent by key. */
  @Post('confirmed')
  createConfirmed(
    @Body() dto: CreateCounterVoucherDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.vouchers.createConfirmed(this.type, dto, user.sub, context);
  }

  @Get()
  findAll(@Query() query: FindOtherVouchersQueryDto) {
    return this.vouchers.findAll(this.type, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vouchers.findOne(this.type, id);
  }

  @Get(':id/activities')
  activities(@Param('id') id: string) {
    return this.vouchers.activities(this.type, id);
  }

  @Patch(':id')
  @PermissionAction('create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCounterVoucherDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.vouchers.update(this.type, id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.vouchers.remove(this.type, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('create')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.confirm(this.type, id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('create')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.cancel(this.type, id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.archive(this.type, id, user.sub);
  }
}

/** Other Receipt (تحصيل آخر): Dr cash / bank, Cr the counter-account. */
@Controller('financial-transactions/other-receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule(JOURNAL_ENTRIES)
export class OtherReceiptsController extends CounterVoucherRoutes {
  protected readonly type = FinancialTransactionType.OTHER_RECEIPT;
}

/** Other Payment (صرف آخر): Dr the counter-account, Cr cash / bank. */
@Controller('financial-transactions/other-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule(JOURNAL_ENTRIES)
export class OtherPaymentsController extends CounterVoucherRoutes {
  protected readonly type = FinancialTransactionType.OTHER_PAYMENT;
}

/** Internal Transfer (تحويل بين الحسابات): Dr destination, Cr source — never income / expense. */
@Controller('financial-transactions/transfers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule(JOURNAL_ENTRIES)
export class TransfersController {
  private readonly type = FinancialTransactionType.INTERNAL_TRANSFER;

  constructor(private readonly vouchers: OtherVouchersService) {}

  @Post()
  create(
    @Body() dto: CreateTransferDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.vouchers.create(this.type, dto, user.sub, context);
  }

  @Post('confirmed')
  createConfirmed(
    @Body() dto: CreateTransferDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.vouchers.createConfirmed(this.type, dto, user.sub, context);
  }

  @Get()
  findAll(@Query() query: FindOtherVouchersQueryDto) {
    return this.vouchers.findAll(this.type, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vouchers.findOne(this.type, id);
  }

  @Get(':id/activities')
  activities(@Param('id') id: string) {
    return this.vouchers.activities(this.type, id);
  }

  @Patch(':id')
  @PermissionAction('create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTransferDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.vouchers.update(this.type, id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.vouchers.remove(this.type, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('create')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.confirm(this.type, id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('create')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.cancel(this.type, id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.archive(this.type, id, user.sub);
  }
}
