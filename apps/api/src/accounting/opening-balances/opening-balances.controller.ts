import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { OpeningBalancesService } from './opening-balances.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';

/** Read access reuses the existing `/journal-entries?sourceType=OPENING_BALANCE&sourceId=...` filter (TASK-054) — no duplicate read endpoint here. */
@Controller('accounting/opening-balances')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('opening-balances')
export class OpeningBalancesController {
  constructor(private readonly openingBalances: OpeningBalancesService) {}

  @Post()
  create(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.openingBalances.create(dto, user.sub);
  }
}
