import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvestorLedgerService } from './investor-ledger.service';
import { FindLedgerStatementQueryDto } from './dto/find-ledger-statement-query.dto';
import { CreateLedgerAdjustmentDto } from './dto/create-ledger-adjustment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Investor Engine Milestone 3, Phase 13-16/28-30/45-46 — the investor-facing subledger, never the accounting General Ledger. */
@Controller('investor-ledger')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investor-ledger')
export class InvestorLedgerController {
  constructor(private readonly ledgerService: InvestorLedgerService) {}

  @Get('statement/:investorId')
  statement(
    @Param('investorId') investorId: string,
    @Query() query: FindLedgerStatementQueryDto,
  ) {
    return this.ledgerService.statement(investorId, query);
  }

  @Get('summary/:investorId')
  summary(@Param('investorId') investorId: string) {
    return this.ledgerService.summary(investorId);
  }

  @Post('adjust')
  @PermissionAction('manage')
  adjust(
    @Body() dto: CreateLedgerAdjustmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ledgerService.adjust(dto, user.sub);
  }
}
