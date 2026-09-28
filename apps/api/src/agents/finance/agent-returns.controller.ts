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
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentFulfillmentService } from './agent-fulfillment.service';
import { ReceiveAgentReturnDto } from './dto/agent-finance.dto';

/**
 * Return receipts for agent orders (spec §6.5) — internal Shipping
 * (`shipping.edit` to record, `shipping.view` to list).
 */
@Controller('agent-returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('shipping')
export class AgentReturnsController {
  constructor(
    private readonly fulfillment: AgentFulfillmentService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('orders/:orderId')
  @PermissionAction('view')
  list(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.prisma.agentOrderReturn.findMany({
      where: { storeOrderId: orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('orders/:orderId')
  @PermissionAction('edit')
  receive(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: ReceiveAgentReturnDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fulfillment.receiveReturn(orderId, dto, user.sub);
  }
}
