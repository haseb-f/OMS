import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { RunDepreciationDto } from '../../fixed-assets/dto/lifecycle.dto';
import { AccountingSchedulesService } from './accounting-schedules.service';

/** "Post due entries now" — the same run the daily cron performs. */
@Controller('accounting-schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fixed-assets')
export class AccountingSchedulesController {
  constructor(private readonly schedules: AccountingSchedulesService) {}

  @Post('run')
  @HttpCode(200)
  @PermissionAction('edit')
  run(@Body() dto: RunDepreciationDto, @CurrentUser() user: JwtPayload) {
    return this.schedules.runDue(dto.asOf, user.sub);
  }
}
