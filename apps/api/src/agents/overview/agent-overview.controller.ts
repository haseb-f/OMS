import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AgentOverviewService } from './agent-overview.service';
import { AgentsOverviewQueryDto } from './dto/agent-overview.dto';

/**
 * Company agent overviews (R15 W1). Internal tokens only (`JwtAuthGuard`
 * refuses agent tokens on non-portal routes), `agents.view`; money inside the
 * responses follows `agents.finance.view` (service). The cross-agent route is
 * `/agents-overview` because `GET /agents/:id` (UUID) owns `/agents/<word>`.
 */
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agents')
export class AgentOverviewController {
  constructor(private readonly overviews: AgentOverviewService) {}

  @Get('agents-overview')
  @PermissionAction('view')
  overview(
    @Query() query: AgentsOverviewQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.overviews.overview(user.sub, query.ids);
  }

  @Get('agents/:id/overview')
  @PermissionAction('view')
  agentOverview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.overviews.agentOverview(user.sub, id);
  }
}
