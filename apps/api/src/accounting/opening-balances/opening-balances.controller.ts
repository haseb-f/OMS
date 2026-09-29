import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { OpeningBalancesService } from './opening-balances.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';

/** The go-live Opening entry itself is read through `/journal-entries?sourceType=OPENING_BALANCE&sourceId=...` (TASK-054); `GET fiscal-years/:id` is the year's derived opening position. */
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

  @Get('fiscal-years/:fiscalYearId')
  @PermissionAction('view')
  derived(@Param('fiscalYearId', ParseUUIDPipe) fiscalYearId: string) {
    return this.openingBalances.derived(fiscalYearId);
  }
}
