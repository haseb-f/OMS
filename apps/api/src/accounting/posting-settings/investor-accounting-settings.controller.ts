import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PostingSettingsService } from './posting-settings.service';
import { UpdateInvestorAccountingSettingsDto } from './dto/update-investor-accounting-settings.dto';

/**
 * Investor Engine Milestone 3, Phase 19/51 — reuses the same
 * `PostingSettingsService` singleton (never a parallel settings entity),
 * exposed under its own dedicated permission module so a Finance user
 * without `investment-accounting.configure` cannot touch the Investor
 * mappings even though they can create/approve/pay Distributions and
 * Capital Returns day to day.
 */
@Controller('investment-accounting-settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-accounting')
export class InvestorAccountingSettingsController {
  constructor(
    private readonly postingSettingsService: PostingSettingsService,
  ) {}

  @Get()
  get() {
    return this.postingSettingsService.get();
  }

  @Patch()
  @PermissionAction('manage')
  update(
    @Body() dto: UpdateInvestorAccountingSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.postingSettingsService.update(dto, user.sub);
  }
}
