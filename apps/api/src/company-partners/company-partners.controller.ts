import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CompanyPartnersService } from './company-partners.service';
import { PartnerProfitService } from './partner-profit.service';
import { PartnerPaymentsService } from './partner-payments.service';
import { PartnerStatementService } from './partner-statement.service';
import { PartnerLoginsService } from './partner-logins.service';
import { ResetPasswordDto } from '../users/dto/reset-password.dto';
import {
  AdjustPartnerProfitPeriodDto,
  CreateCompanyPartnerDto,
  CreatePartnerLoginDto,
  LinkPartnerLoginDto,
  PartnerLoginCandidatesQueryDto,
  CreatePartnerAgreementDto,
  CreatePartnerPaymentDto,
  EndPartnerAgreementDto,
  FindPartnerAgreementsQueryDto,
  FindPartnerPaymentsQueryDto,
  PartnerProfitRangeQueryDto,
  PartnerStatementQueryDto,
  ReversePartnerPaymentDto,
  SavePartnerProfitPeriodDto,
  SupersedePartnerAgreementDto,
  UpdateCompanyPartnerDto,
  UpdatePartnerAgreementDto,
} from './dto/company-partners.dto';

/**
 * R14 W5 — "الشركاء". Internal screens. Matrix row `company-partners`: view /
 * manage (profiles, agreements) / close (review, close, adjust periods) /
 * pay (payments and their reversal) / portal (R15 — the partner's own login).
 * The partner's own view is the separate `/partner-portal/*` API.
 */
@Controller('company-partners/profiles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('company-partners')
export class CompanyPartnerProfilesController {
  constructor(
    private readonly partners: CompanyPartnersService,
    private readonly statements: PartnerStatementService,
  ) {}

  @Get()
  list() {
    return this.partners.list();
  }

  /** Existing partners that can be added (the "add partner" picker). */
  @Get('candidates')
  @PermissionAction('manage')
  candidates(@Query('search') search?: string) {
    return this.partners.candidates(search);
  }

  @Get(':partnerId')
  findOne(@Param('partnerId', ParseUUIDPipe) partnerId: string) {
    return this.partners.findOne(partnerId);
  }

  @Get(':partnerId/statement')
  statement(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Query() query: PartnerStatementQueryDto,
  ) {
    return this.statements.statement(partnerId, query.from, query.to);
  }

  @Post()
  @PermissionAction('manage')
  create(
    @Body() dto: CreateCompanyPartnerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partners.create(dto, user.sub);
  }

  @Patch(':partnerId')
  @PermissionAction('manage')
  update(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Body() dto: UpdateCompanyPartnerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partners.update(partnerId, dto, user.sub);
  }
}

@Controller('company-partners/agreements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('company-partners')
export class PartnerAgreementsController {
  constructor(private readonly partners: CompanyPartnersService) {}

  @Get()
  list(@Query() query: FindPartnerAgreementsQueryDto) {
    return this.partners.listAgreements(query.partnerId);
  }

  @Post()
  @PermissionAction('manage')
  create(
    @Body() dto: CreatePartnerAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partners.createAgreement(dto, user.sub);
  }

  @Patch(':id')
  @PermissionAction('manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partners.updateAgreement(id, dto, user.sub);
  }

  @Post(':id/activate')
  @PermissionAction('manage')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partners.activateAgreement(id, user.sub);
  }

  @Post(':id/end')
  @PermissionAction('manage')
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndPartnerAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partners.endAgreement(id, dto, user.sub);
  }

  @Post(':id/supersede')
  @PermissionAction('manage')
  supersede(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupersedePartnerAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partners.supersedeAgreement(id, dto, user.sub);
  }
}

@Controller('company-partners/periods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('company-partners')
export class PartnerProfitPeriodsController {
  constructor(private readonly profit: PartnerProfitService) {}

  /** Live estimate for any range — nothing is stored. */
  @Get('preview')
  preview(@Query() query: PartnerProfitRangeQueryDto) {
    return this.profit.calculate(query.from, query.to);
  }

  @Get()
  list() {
    return this.profit.listPeriods();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.profit.findPeriod(id);
  }

  @Post()
  @PermissionAction('close')
  saveReview(
    @Body() dto: SavePartnerProfitPeriodDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.profit.saveReview(dto.periodFrom, dto.periodTo, user.sub);
  }

  @Post(':id/close')
  @PermissionAction('close')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.profit.close(id, user.sub);
  }

  @Post(':id/adjustments')
  @PermissionAction('close')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustPartnerProfitPeriodDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.profit.adjust(id, dto.reason, user.sub);
  }
}

@Controller('company-partners/payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('company-partners')
export class PartnerPaymentsController {
  constructor(private readonly payments: PartnerPaymentsService) {}

  @Get()
  list(@Query() query: FindPartnerPaymentsQueryDto) {
    return this.payments.list(query.partnerId);
  }

  @Post()
  @PermissionAction('pay')
  create(
    @Body() dto: CreatePartnerPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.create(dto, user.sub);
  }

  @Post(':id/reverse')
  @PermissionAction('pay')
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePartnerPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.reverse(id, dto, user.sub);
  }
}

/**
 * R15 (D15-14) — the partner's own login, from the partner page. Every
 * action needs `company-partners.users.manage` (matrix action `portal`).
 */
@Controller('company-partners')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('company-partners')
export class PartnerLoginsController {
  constructor(private readonly logins: PartnerLoginsService) {}

  @Get('logins/candidates')
  @PermissionAction('portal')
  candidates(@Query() query: PartnerLoginCandidatesQueryDto) {
    return this.logins.candidates(query.search);
  }

  /** Returns the generated temporary password once (changed at first sign-in). */
  @Post('profiles/:partnerId/login')
  @PermissionAction('portal')
  create(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Body() dto: CreatePartnerLoginDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.logins.create(partnerId, dto, user.sub);
  }

  @Post('profiles/:partnerId/login/link')
  @HttpCode(200)
  @PermissionAction('portal')
  link(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Body() dto: LinkPartnerLoginDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.logins.link(partnerId, dto, user.sub);
  }

  @Post('profiles/:partnerId/login/unlink')
  @HttpCode(200)
  @PermissionAction('portal')
  unlink(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.logins.unlink(partnerId, user.sub);
  }

  @Post('profiles/:partnerId/login/disable')
  @HttpCode(200)
  @PermissionAction('portal')
  disable(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.logins.setActive(partnerId, false, user.sub);
  }

  @Post('profiles/:partnerId/login/enable')
  @HttpCode(200)
  @PermissionAction('portal')
  enable(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.logins.setActive(partnerId, true, user.sub);
  }

  /** Server-generated password when `newPassword` is omitted; every session of the login ends. */
  @Post('profiles/:partnerId/login/reset-password')
  @HttpCode(200)
  @PermissionAction('portal')
  resetPassword(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.logins.resetPassword(partnerId, dto ?? {}, user.sub);
  }
}
