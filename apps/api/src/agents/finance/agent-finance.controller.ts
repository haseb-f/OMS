import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AgentLedgerService } from './agent-ledger.service';
import { AgentStatementService } from './agent-statement.service';
import { AgentPayoutsService } from './agent-payouts.service';
import { AgentCollectionsService } from './agent-collections.service';
import { AgentAdjustmentsService } from './agent-adjustments.service';
import { AgentCommissionReportService } from './agent-commission-report.service';
import {
  AgentAdjustmentDto,
  AgentCollectionsQueryDto,
  AgentLedgerQueryDto,
  AgentPageQueryDto,
  AgentPaymentStagesQueryDto,
  AgentPeriodQueryDto,
  AgentRefundDto,
  CreateAgentPayoutDto,
  PostPendingDto,
  ReasonDto,
} from './dto/agent-finance.dto';

/**
 * Internal Finance endpoints for agents (spec §7–§10). Module
 * `agent-finance`: view · confirm (= agents.finance.verify) · post ·
 * edit (= agents.finance.adjust) · create/reverse (payouts) · print.
 * Internal tokens only (agent tokens are denied by JwtAuthGuard).
 */
@Controller('agent-finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agent-finance')
export class AgentFinanceController {
  constructor(
    private readonly ledger: AgentLedgerService,
    private readonly statements: AgentStatementService,
    private readonly payouts: AgentPayoutsService,
    private readonly collections: AgentCollectionsService,
    private readonly adjustments: AgentAdjustmentsService,
    private readonly commissionReport: AgentCommissionReportService,
  ) {}

  // ── Commission report (commission-policy.md A7) ──

  @Get('agents/:agentId/commission-report')
  @PermissionAction('view')
  commissionReportFor(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: AgentPeriodQueryDto,
  ) {
    return this.commissionReport.report(agentId, query);
  }

  // ── Agent collections (agent-destination payments) ──────────────────────

  @Get('collections')
  @PermissionAction('view')
  collectionsQueue(@Query() query: AgentCollectionsQueryDto) {
    return this.collections.queue(query);
  }

  @Post('collections/:paymentId/verify')
  @HttpCode(200)
  @PermissionAction('confirm')
  verifyCollection(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.collections.verify(paymentId, user.sub);
  }

  @Post('collections/:paymentId/reject')
  @HttpCode(200)
  @PermissionAction('confirm')
  rejectCollection(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.collections.reject(paymentId, dto.reason, user.sub);
  }

  // ── Ledger / statement ──────────────────────────────────────────────────

  @Get('agents/:agentId/ledger')
  @PermissionAction('view')
  ledgerList(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: AgentLedgerQueryDto,
  ) {
    return this.statements.listLedger(agentId, query);
  }

  @Get('agents/:agentId/statement')
  @PermissionAction('view')
  statement(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: AgentPeriodQueryDto,
  ) {
    return this.statements.statement(agentId, query);
  }

  /** Same data as the statement, gated by `agents.statement.print` (print/export). */
  @Get('agents/:agentId/statement/print')
  @PermissionAction('print')
  statementPrint(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: AgentPeriodQueryDto,
  ) {
    return this.statements.statement(agentId, query);
  }

  @Get('agents/:agentId/summary')
  @PermissionAction('view')
  summary(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: AgentPeriodQueryDto,
  ) {
    return this.statements.summary(agentId, query);
  }

  @Get('agents/:agentId/payments')
  @PermissionAction('view')
  paymentStages(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: AgentPaymentStagesQueryDto,
  ) {
    return this.statements.paymentStages(agentId, query);
  }

  // ── Pending postings (decision D1) ──────────────────────────────────────

  @Get('pending-postings')
  @PermissionAction('view')
  pendingPostings(@Query() query: PostPendingDto) {
    return this.statements.listPendingPostings(query.agentId);
  }

  @Post('pending-postings/post')
  @HttpCode(200)
  @PermissionAction('post')
  postPending(@Body() dto: PostPendingDto, @CurrentUser() user: JwtPayload) {
    return this.ledger.postPending(dto.agentId, user.sub);
  }

  // ── Payouts ─────────────────────────────────────────────────────────────

  @Get('agents/:agentId/payouts')
  @PermissionAction('view')
  listPayouts(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query() query: AgentPageQueryDto,
  ) {
    return this.payouts.list(agentId, query);
  }

  @Get('agents/:agentId/payouts/preview')
  @PermissionAction('create')
  previewPayout(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.payouts.preview(agentId);
  }

  @Post('agents/:agentId/payouts')
  @PermissionAction('create')
  createPayout(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: CreateAgentPayoutDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payouts.create(agentId, dto, user.sub);
  }

  @Get('payouts/:id')
  @PermissionAction('view')
  payoutDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.detail(id);
  }

  @Post('payouts/:id/reverse')
  @HttpCode(200)
  @PermissionAction('reverse')
  reversePayout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payouts.reverse(id, dto.reason, user.sub);
  }

  // ── Refunds / adjustments ───────────────────────────────────────────────

  @Post('orders/:orderId/refunds')
  @PermissionAction('edit')
  refund(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AgentRefundDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adjustments.refund(orderId, dto, user.sub);
  }

  @Post('agents/:agentId/adjustments')
  @PermissionAction('edit')
  adjust(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: AgentAdjustmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adjustments.adjust(agentId, dto, user.sub);
  }
}
