import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { AccountingFoundationService } from './accounting-foundation.service';

@Controller('accounting/foundation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fiscal-configuration')
export class AccountingFoundationController {
  constructor(private readonly foundation: AccountingFoundationService) {}

  @Post('activate')
  @PermissionAction('manage')
  activate(@CurrentUser() user: JwtPayload) {
    return this.foundation.activate(user.sub);
  }
}
