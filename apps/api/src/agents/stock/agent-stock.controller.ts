import {
  Body,
  Controller,
  Get,
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
import { AgentStockReceiptsService } from './agent-stock-receipts.service';
import { AgentStockHistoryService } from './agent-stock-history.service';
import {
  AgentStockMovementsQueryDto,
  CreateAgentStockReceiptDto,
  FindAgentStockReceiptsQueryDto,
} from './dto/agent-stock.dto';

/**
 * R18 B — agent stock receipts (custody of agent-owned goods). Reading is
 * `agents.view`; recording posts stock, so it needs the Inventory
 * "movements" right (`inventory.movements.create`), and an OPENING receipt
 * additionally `inventory.opening-stock.create` (checked in the service).
 */
@Controller('agent-stock-receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agents')
export class AgentStockReceiptsController {
  constructor(private readonly receipts: AgentStockReceiptsService) {}

  @Get()
  list(@Query() query: FindAgentStockReceiptsQueryDto) {
    return this.receipts.list(query);
  }

  @Post()
  @PermissionModule('inventory')
  @PermissionAction('create')
  create(
    @Body() dto: CreateAgentStockReceiptDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.receipts.create(dto, user.sub);
  }
}

/** R18 B — the agent page's stock movement history (`agents.view`). */
@Controller('agents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agents')
export class AgentStockMovementsController {
  constructor(private readonly history: AgentStockHistoryService) {}

  @Get(':id/stock-movements')
  movements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AgentStockMovementsQueryDto,
  ) {
    return this.history.movements(id, query);
  }
}
