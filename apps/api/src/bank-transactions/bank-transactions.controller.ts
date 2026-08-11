import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BankTransactionsService } from './bank-transactions.service';
import { FindBankTransactionsQueryDto } from './dto/find-bank-transactions-query.dto';
import { ConfirmMatchDto } from './dto/confirm-match.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Bank Transaction review + reconciliation (Part 10). Business operations: Run Matching, Confirm Match. */
@Controller('bank-transactions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('bank-transactions')
export class BankTransactionsController {
  constructor(private readonly bankTransactions: BankTransactionsService) {}

  @Get()
  findAll(@Query() query: FindBankTransactionsQueryDto) {
    return this.bankTransactions.findAll(query);
  }

  @Get('status-counts')
  statusCounts() {
    return this.bankTransactions.statusCounts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bankTransactions.findOne(id);
  }

  @Post('run-matching')
  @PermissionAction('manage')
  runMatching() {
    return this.bankTransactions.runMatching();
  }

  @Post(':id/confirm-match')
  @PermissionAction('manage')
  confirmMatch(
    @Param('id') id: string,
    @Body() dto: ConfirmMatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bankTransactions.confirmMatch(id, dto, user.sub);
  }
}
