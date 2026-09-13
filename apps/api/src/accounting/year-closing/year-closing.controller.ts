import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { YearClosingService } from './year-closing.service';
import { CloseYearDto } from './dto/close-year.dto';

@Controller('accounting/year-closing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fiscal-configuration')
export class YearClosingController {
  constructor(private readonly yearClosing: YearClosingService) {}

  @Post()
  @PermissionAction('manage')
  execute(@Body() dto: CloseYearDto, @CurrentUser() user: JwtPayload) {
    return this.yearClosing.execute(dto, user.sub);
  }
}
