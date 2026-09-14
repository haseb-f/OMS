import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InvestorPortalAdminService } from './investor-portal-admin.service';
import { InvitePortalAccountDto } from './dto/invite-portal-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/**
 * Investor Engine Milestone 4, Part J/K — internal Admin management of an
 * Investor's Portal access. Deliberately its own `@PermissionModule`
 * (`investor-portal`, distinct from `investors`) — see
 * `permission-catalog.ts`: `view` -> GET status, `create` -> invite,
 * `manage` -> every other action (resend/suspend/reactivate/disable).
 */
@Controller('investors/:investorId/portal')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investor-portal')
export class InvestorPortalAdminController {
  constructor(private readonly admin: InvestorPortalAdminService) {}

  @Get()
  status(@Param('investorId') investorId: string) {
    return this.admin.getStatus(investorId);
  }

  @Post('invite')
  @HttpCode(200)
  invite(
    @Param('investorId') investorId: string,
    @Body() dto: InvitePortalAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.admin.invite(investorId, dto, user.sub);
  }

  @Post('resend-invite')
  @HttpCode(200)
  @PermissionAction('manage')
  resendInvite(@Param('investorId') investorId: string) {
    return this.admin.resendInvite(investorId);
  }

  @Post('suspend')
  @HttpCode(200)
  @PermissionAction('manage')
  suspend(@Param('investorId') investorId: string) {
    return this.admin.suspend(investorId);
  }

  @Post('reactivate')
  @HttpCode(200)
  @PermissionAction('manage')
  reactivate(@Param('investorId') investorId: string) {
    return this.admin.reactivate(investorId);
  }

  @Post('disable')
  @HttpCode(200)
  @PermissionAction('manage')
  disable(@Param('investorId') investorId: string) {
    return this.admin.disable(investorId);
  }
}
