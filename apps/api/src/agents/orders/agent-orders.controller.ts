import {
  Body,
  Controller,
  Get,
  Headers,
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
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AgentOrdersService } from './agent-orders.service';
import {
  AgentOrderPricingDto,
  ConfirmCustomerTotalDto,
  ConvertAgentLeadDto,
  CreateAgentOrderDto,
  DeclareAgentOrderPaymentDto,
} from './dto/agent-order.dto';
import { FindStoreOrdersQueryDto } from '../../store-orders/dto/find-store-orders-query.dto';

/**
 * Internal staff entering orders for an agent (spec §6). Internal-only
 * (agent tokens are refused by `JwtAuthGuard`); the agent portal (B3) calls
 * `AgentOrdersService` with the verified agent context instead.
 *  - quote: `agents.view`
 *  - create / convert: `agents.edit`, or `store-orders.create` + `agents.view`
 *  - declaration: the store-order declaration permissions (any-of)
 */
@Controller('agent-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agents')
export class AgentOrdersController {
  constructor(private readonly orders: AgentOrdersService) {}

  @Post('quote')
  @HttpCode(200)
  @PermissionAction('view')
  quote(@Body() dto: AgentOrderPricingDto, @CurrentUser() user: JwtPayload) {
    return this.orders.quote(dto, { userId: user.sub });
  }

  @Post()
  @SkipPermissionCheck()
  create(
    @Body() dto: CreateAgentOrderDto,
    @CurrentUser() user: JwtPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orders.createAgentOrder(
      { ...dto, idempotencyKey: dto.idempotencyKey ?? idempotencyKey },
      { userId: user.sub },
    );
  }

  @Post('leads/:leadId/convert')
  @SkipPermissionCheck()
  convertLead(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: ConvertAgentLeadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orders.convertAgentLead(leadId, dto, { userId: user.sub });
  }

  @Post(':orderId/payment-declaration')
  @SkipPermissionCheck()
  declare(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: DeclareAgentOrderPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orders.declareAgentOrderPayment(orderId, dto, {
      userId: user.sub,
    });
  }

  /**
   * Spec 2 — shipping pricing state + internal shipping economics
   * (contractual fee vs actual carrier cost → margin). `agents.view`.
   */
  @Get(':orderId/shipping-pricing')
  @PermissionAction('view')
  shippingPricing(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orders.shippingPricing(orderId, { userId: user.sub });
  }

  /** Spec 2 — "Customer agreed to pay {new total}" (`agents.edit`, checked in the service). */
  @Post(':orderId/customer-total/confirm')
  @HttpCode(200)
  @SkipPermissionCheck()
  confirmCustomerTotal(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: ConfirmCustomerTotalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orders.confirmCustomerTotal(orderId, dto, {
      userId: user.sub,
    });
  }
}

/**
 * Agents workspace → Orders tab. `agents.view` holders manage the agent, so
 * the list is agent-scoped and not narrowed by the internal sales scope
 * (`GET /store-orders?agentId=` is — Finance would see nothing there).
 */
@Controller('agents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agents')
export class AgentWorkspaceOrdersController {
  constructor(private readonly orders: AgentOrdersService) {}

  @Get(':id/orders')
  @PermissionAction('view')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FindStoreOrdersQueryDto,
  ) {
    return this.orders.listForAgent(id, query);
  }
}
