import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { AccountingReportsService } from './accounting-reports.service';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { JournalReportQueryDto } from './dto/journal-report-query.dto';
import { AccountStatementQueryDto } from './dto/account-statement-query.dto';
import { BalanceSheetQueryDto } from './dto/balance-sheet-query.dto';
import { IncomeStatementQueryDto } from './dto/income-statement-query.dto';
import { CashFlowQueryDto } from './dto/cash-flow-query.dto';

/** TASK-047/051 Financial Reports & Statements — read-only endpoints only, no create/update/delete anywhere on this controller. */
@Controller('accounting/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('financial-reports')
export class AccountingReportsController {
  constructor(private readonly reports: AccountingReportsService) {}

  @Get('general-ledger')
  generalLedger(@Query() query: GeneralLedgerQueryDto) {
    return this.reports.generalLedger(query);
  }

  @Get('trial-balance')
  trialBalance(@Query() query: TrialBalanceQueryDto) {
    return this.reports.trialBalance(query);
  }

  @Get('journal-report')
  journalReport(@Query() query: JournalReportQueryDto) {
    return this.reports.journalReport(query);
  }

  @Get('account-statement')
  accountStatement(@Query() query: AccountStatementQueryDto) {
    return this.reports.accountStatement(query);
  }

  @Get('balance-sheet')
  balanceSheet(@Query() query: BalanceSheetQueryDto) {
    return this.reports.balanceSheet(query);
  }

  @Get('income-statement')
  incomeStatement(@Query() query: IncomeStatementQueryDto) {
    return this.reports.incomeStatement(query);
  }

  @Get('cash-flow')
  cashFlow(@Query() query: CashFlowQueryDto) {
    return this.reports.cashFlowStatement(query);
  }
}
