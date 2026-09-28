import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AgentUsersService } from './agent-users.service';
import {
  CreateAgentUserDto,
  SetAgentUserPermissionsDto,
} from './dto/agent-user.dto';

/**
 * "Agent team" tab (spec §3, §10) — internal `agents.users.view|manage`.
 */
@Controller('agents/:agentId/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agent-users')
export class AgentUsersController {
  constructor(private readonly agentUsers: AgentUsersService) {}

  @Get()
  list(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.agentUsers.list(agentId);
  }

  /** Returns the generated temporary password once (must change at first login). */
  @Post()
  @PermissionAction('manage')
  create(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: CreateAgentUserDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agentUsers.create(agentId, dto, user.sub);
  }

  @Put(':userId/permissions')
  @PermissionAction('manage')
  setPermissions(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetAgentUserPermissionsDto,
  ) {
    return this.agentUsers.setPermissions(agentId, userId, dto.permissionNames);
  }

  @Post(':userId/deactivate')
  @PermissionAction('manage')
  deactivate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agentUsers.setActive(agentId, userId, false, {
      userId: user.sub,
      kind: 'INTERNAL',
    });
  }

  @Post(':userId/activate')
  @PermissionAction('manage')
  activate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agentUsers.setActive(agentId, userId, true, {
      userId: user.sub,
      kind: 'INTERNAL',
    });
  }

  @Post(':userId/reset-password')
  @PermissionAction('manage')
  resetPassword(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.agentUsers.resetPassword(agentId, userId);
  }
}
