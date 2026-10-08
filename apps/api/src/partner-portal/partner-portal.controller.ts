import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PartnerPortal } from '../auth/decorators/partner-access.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { PartnerRequestContext } from '../auth/guards/jwt-auth.guard';
import { PartnerStatementQueryDto } from '../company-partners/dto/company-partners.dto';
import {
  CurrentPartner,
  PartnerPermissionGuard,
  RequirePartnerPermission,
} from './partner-permission.guard';
import { PartnerPortalService } from './partner-portal.service';

/**
 * R15 (D15-14) — `/partner-portal/*`: partner logins only (`@PartnerPortal()`;
 * internal and agent tokens → 403), JWT with a live link check, then
 * `PartnerPermissionGuard`, which refuses any handler without
 * `@RequirePartnerPermission` (fail closed). The partner always comes from
 * `@CurrentPartner()` — there is no partner id in any URL.
 */
@Controller('partner-portal')
@PartnerPortal()
@UseGuards(JwtAuthGuard, PartnerPermissionGuard)
export class PartnerPortalController {
  constructor(private readonly portal: PartnerPortalService) {}

  @Get('me')
  @RequirePartnerPermission('partner.dashboard.view')
  me(@CurrentPartner() partner: PartnerRequestContext) {
    return this.portal.me(partner);
  }

  @Get('summary')
  @RequirePartnerPermission('partner.dashboard.view')
  summary(@CurrentPartner() partner: PartnerRequestContext) {
    return this.portal.summary(partner);
  }

  @Get('periods')
  @RequirePartnerPermission('partner.statement.view')
  periods(@CurrentPartner() partner: PartnerRequestContext) {
    return this.portal.periods(partner);
  }

  @Get('periods/:periodId')
  @RequirePartnerPermission('partner.statement.view')
  period(
    @CurrentPartner() partner: PartnerRequestContext,
    @Param('periodId', ParseUUIDPipe) periodId: string,
  ) {
    return this.portal.period(partner, periodId);
  }

  @Get('statement')
  @RequirePartnerPermission('partner.statement.view')
  statement(
    @CurrentPartner() partner: PartnerRequestContext,
    @Query() query: PartnerStatementQueryDto,
  ) {
    return this.portal.statement(partner, query);
  }
}
