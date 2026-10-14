import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
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
 * R22 (decision D4, review T2) — authorisation: the rights of the manual
 * journal entry these vouchers replace, action for action (separation of
 * duties): `accounting.journal-entries.create` creates a draft, `.edit`
 * edits it, `.post` confirms (posts) it, `.reverse` cancels (reverses) it,
 * `.view` lists / reads, `.archive` deletes a draft / archives a cancelled
 * one. Create + Confirm in one step needs `.create` AND `.post`. No new
 * permission, no new grant.
 */
const JOURNAL_ENTRIES = 'journal-entries';
const JOURNAL_ENTRIES_CREATE = 'accounting.journal-entries.create';

/** Create + Confirm in one step: the guard checks `.post`; this adds `.create`. */
async function assertMayCreate(
  permissions: PermissionsResolverService,
  userId: string,
) {
  if (!(await permissions.hasPermission(userId, JOURNAL_ENTRIES_CREATE))) {
    throw new ForbiddenException(
      `Missing permission "${JOURNAL_ENTRIES_CREATE}".`,
    );
  }
}

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

  constructor(
    protected readonly vouchers: OtherVouchersService,
    protected readonly permissions: PermissionsResolverService,
  ) {}

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
  @PermissionAction('post')
  async createConfirmed(
    @Body() dto: CreateCounterVoucherDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    await assertMayCreate(this.permissions, user.sub);
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
  @PermissionAction('edit')
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
  @PermissionAction('post')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.confirm(this.type, id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('reverse')
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

  // Explicit so Nest's DI reads this class's own constructor metadata.
  constructor(
    vouchers: OtherVouchersService,
    permissions: PermissionsResolverService,
  ) {
    super(vouchers, permissions);
  }
}

/** Other Payment (صرف آخر): Dr the counter-account, Cr cash / bank. */
@Controller('financial-transactions/other-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule(JOURNAL_ENTRIES)
export class OtherPaymentsController extends CounterVoucherRoutes {
  protected readonly type = FinancialTransactionType.OTHER_PAYMENT;

  // Explicit so Nest's DI reads this class's own constructor metadata.
  constructor(
    vouchers: OtherVouchersService,
    permissions: PermissionsResolverService,
  ) {
    super(vouchers, permissions);
  }
}

/** Internal Transfer (تحويل بين الحسابات): Dr destination, Cr source — never income / expense. */
@Controller('financial-transactions/transfers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule(JOURNAL_ENTRIES)
export class TransfersController {
  private readonly type = FinancialTransactionType.INTERNAL_TRANSFER;

  constructor(
    private readonly vouchers: OtherVouchersService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateTransferDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    return this.vouchers.create(this.type, dto, user.sub, context);
  }

  @Post('confirmed')
  @PermissionAction('post')
  async createConfirmed(
    @Body() dto: CreateTransferDto,
    @CurrentUser() user: JwtPayload,
    @CurrentCompanyContext() context: CompanyContext,
  ) {
    await assertMayCreate(this.permissions, user.sub);
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
  @PermissionAction('edit')
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
  @PermissionAction('post')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vouchers.confirm(this.type, id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('reverse')
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
