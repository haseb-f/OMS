import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AgentPortal } from '../../auth/decorators/agent-access.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  AgentPermissionGuard,
  RequireAgentPermission,
  RequireAnyAgentPermission,
} from '../common/agent-permission.guard';
import { CurrentAgent } from '../common/current-agent.decorator';
import { AgentLeadsService } from '../orders/agent-leads.service';
import {
  CreateAgentLeadDto,
  FindAgentLeadsQueryDto,
} from '../orders/dto/agent-lead.dto';
import {
  AgentOrderPricingDto,
  ConfirmCustomerTotalDto,
  ConvertAgentLeadDto,
  CreateAgentOrderDto,
  DeclareAgentOrderPaymentDto,
} from '../orders/dto/agent-order.dto';
import {
  CreateAgentSalesUserDto,
  SetAgentUserPermissionsDto,
} from '../admin/dto/agent-user.dto';
import { AgentPortalService } from './agent-portal.service';
import { AgentPortalOrdersService } from './agent-portal-orders.service';
import { AgentPortalTeamService } from './agent-portal-team.service';
import { StoreOrderDuplicatesService } from '../../store-orders/duplicates/store-order-duplicates.service';
import { AgentDuplicateCheckDto } from '../../store-orders/duplicates/dto/duplicate.dto';
import {
  AgentPortalOrdersQueryDto,
  AgentPortalPageQueryDto,
  AgentPortalProductsQueryDto,
  AgentPortalStatementQueryDto,
  AgentPortalStockQueryDto,
  AssignAgentLeadDto,
} from './dto/agent-portal.dto';

/**
 * Every `/agent-portal/*` controller: agent tokens only (`@AgentPortal()`;
 * internal tokens → 403), JWT with live affiliation check, then
 * `AgentPermissionGuard`, which refuses any handler without
 * `@RequireAgentPermission` (fail closed). The agent id always comes from
 * `@CurrentAgent()` — never a route param, query or body field.
 */
const AgentPortalController = (path: string) =>
  applyDecorators(
    Controller(`agent-portal${path}`),
    AgentPortal(),
    UseGuards(JwtAuthGuard, AgentPermissionGuard),
  );

@AgentPortalController('')
export class AgentPortalHomeController {
  constructor(private readonly portal: AgentPortalService) {}

  @Get('me')
  @RequireAgentPermission('agent.dashboard.view')
  me(@CurrentAgent() agent: AgentRequestContext) {
    return this.portal.me(agent);
  }

  @Get('dashboard')
  @RequireAgentPermission('agent.dashboard.view')
  dashboard(@CurrentAgent() agent: AgentRequestContext) {
    return this.portal.dashboard(agent);
  }

  /** Needs `agent.orders.create` or `agent.leads.create` (checked in the handler — the guard is all-of). */
  @Get('products')
  @RequireAnyAgentPermission('agent.orders.create', 'agent.leads.create')
  products(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalProductsQueryDto,
  ) {
    return this.portal.products(agent, query);
  }

  /**
   * Destination countries for leads / orders (all active countries — a
   * country without a configured rate still resolves shipping as today:
   * override with permission, else blocked).
   */
  @Get('countries')
  @RequireAnyAgentPermission('agent.leads.create', 'agent.orders.create')
  countries() {
    return this.portal.countries();
  }

  @Get('stock')
  @RequireAgentPermission('agent.stock.view')
  stock(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalStockQueryDto,
  ) {
    return this.portal.stock(agent, query);
  }

  @Get('payment-destinations')
  @RequireAgentPermission('agent.payments.declare')
  paymentDestinations(@CurrentAgent() agent: AgentRequestContext) {
    return this.portal.paymentDestinations(agent);
  }

  @Get('attachments/:id/file')
  @RequireAgentPermission('agent.orders.view')
  async attachmentFile(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const file = await this.portal.getAttachmentFile(agent, id);
    return new StreamableFile(file.body, {
      type: file.mimeType,
      disposition: `inline; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }
}

@AgentPortalController('/leads')
export class AgentPortalLeadsController {
  constructor(
    private readonly leads: AgentLeadsService,
    private readonly orders: AgentPortalOrdersService,
  ) {}

  @Get()
  @RequireAgentPermission('agent.leads.view')
  list(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: FindAgentLeadsQueryDto,
  ) {
    return this.leads.list(agent, query);
  }

  @Get(':id')
  @RequireAgentPermission('agent.leads.view')
  get(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.get(agent, id);
  }

  @Post()
  @RequireAgentPermission('agent.leads.create')
  create(
    @CurrentAgent() agent: AgentRequestContext,
    @Body() dto: CreateAgentLeadDto,
  ) {
    return this.leads.create(agent, dto);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequireAgentPermission('agent.team.manage')
  assign(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAgentLeadDto,
  ) {
    return this.leads.assign(agent, id, dto.salesUserId);
  }

  @Post(':id/convert')
  @RequireAgentPermission('agent.leads.convert')
  convert(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertAgentLeadDto,
  ) {
    return this.orders.convertLead(agent, id, dto);
  }
}

@AgentPortalController('/orders')
export class AgentPortalOrdersController {
  constructor(
    private readonly orders: AgentPortalOrdersService,
    private readonly duplicates: StoreOrderDuplicatesService,
  ) {}

  /**
   * Round 5 Spec 1B — duplicate customer check inside the caller's agent.
   * A match outside it returns only `{ kind: 'PHONE', crossScope: true }`.
   */
  @Post('duplicate-check')
  @HttpCode(200)
  @RequireAnyAgentPermission('agent.orders.create', 'agent.leads.convert')
  async duplicateCheck(
    @CurrentAgent() agent: AgentRequestContext,
    @Body() dto: AgentDuplicateCheckDto,
  ) {
    return this.duplicates.check(dto, await this.duplicates.agentScope(agent));
  }

  @Post('quote')
  @HttpCode(200)
  @RequireAgentPermission('agent.orders.create')
  quote(
    @CurrentAgent() agent: AgentRequestContext,
    @Body() dto: AgentOrderPricingDto,
  ) {
    return this.orders.quote(agent, dto);
  }

  @Post()
  @RequireAgentPermission('agent.orders.create')
  create(
    @CurrentAgent() agent: AgentRequestContext,
    @Body() dto: CreateAgentOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orders.create(agent, dto, idempotencyKey);
  }

  @Get()
  @RequireAgentPermission('agent.orders.view')
  list(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalOrdersQueryDto,
  ) {
    return this.orders.list(agent, query);
  }

  @Get(':id')
  @RequireAgentPermission('agent.orders.view')
  detail(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.detail(agent, id);
  }

  @Post(':id/payment-declaration')
  @HttpCode(200)
  @RequireAgentPermission('agent.payments.declare')
  declare(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclareAgentOrderPaymentDto,
  ) {
    return this.orders.declare(agent, id, dto);
  }

  /** Spec 2 — "Customer agreed to pay {new total}" (order owner / agent admin). */
  @Post(':id/customer-total/confirm')
  @HttpCode(200)
  @RequireAgentPermission('agent.orders.create')
  confirmCustomerTotal(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmCustomerTotalDto,
  ) {
    return this.orders.confirmCustomerTotal(agent, id, dto);
  }
}

@AgentPortalController('')
export class AgentPortalFinanceController {
  constructor(private readonly portal: AgentPortalService) {}

  @Get('statement')
  @RequireAgentPermission('agent.statement.view')
  statement(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalStatementQueryDto,
  ) {
    return this.portal.statement(agent, query);
  }

  @Get('statement/summary')
  @RequireAgentPermission('agent.statement.view')
  summary(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalStatementQueryDto,
  ) {
    return this.portal.summary(agent, query);
  }

  @Get('commission-report')
  @RequireAgentPermission('agent.statement.view')
  commissionReport(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalStatementQueryDto,
  ) {
    return this.portal.commissionReportFor(agent, query);
  }

  @Get('statement/print-data')
  @RequireAgentPermission('agent.statement.view')
  printData(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalStatementQueryDto,
  ) {
    return this.portal.statementPrintData(agent, query);
  }

  @Get('payouts')
  @RequireAgentPermission('agent.payouts.view')
  payouts(
    @CurrentAgent() agent: AgentRequestContext,
    @Query() query: AgentPortalPageQueryDto,
  ) {
    return this.portal.payouts(agent, query);
  }

  @Get('payouts/:id')
  @RequireAgentPermission('agent.payouts.view')
  payout(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.payout(agent, id);
  }
}

@AgentPortalController('/team')
export class AgentPortalTeamController {
  constructor(private readonly team: AgentPortalTeamService) {}

  @Get()
  @RequireAgentPermission('agent.team.view')
  list(@CurrentAgent() agent: AgentRequestContext) {
    return this.team.list(agent);
  }

  /** Returns the temporary password once. */
  @Post()
  @RequireAgentPermission('agent.team.manage')
  create(
    @CurrentAgent() agent: AgentRequestContext,
    @Body() dto: CreateAgentSalesUserDto,
  ) {
    return this.team.create(agent, dto);
  }

  @Put(':userId/permissions')
  @RequireAgentPermission('agent.team.manage')
  setPermissions(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetAgentUserPermissionsDto,
  ) {
    return this.team.setPermissions(agent, userId, dto.permissionNames);
  }

  @Post(':userId/deactivate')
  @HttpCode(200)
  @RequireAgentPermission('agent.team.manage')
  deactivate(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.team.setActive(agent, userId, false);
  }

  @Post(':userId/activate')
  @HttpCode(200)
  @RequireAgentPermission('agent.team.manage')
  activate(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.team.setActive(agent, userId, true);
  }

  /** Returns the temporary password once. */
  @Post(':userId/reset-password')
  @HttpCode(200)
  @RequireAgentPermission('agent.team.manage')
  resetPassword(
    @CurrentAgent() agent: AgentRequestContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.team.resetPassword(agent, userId);
  }
}
