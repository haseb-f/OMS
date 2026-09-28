import { Injectable } from '@nestjs/common';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import type { AgentPortalPermission } from '../../permissions/permission-catalog';
import {
  AgentTeamService,
  AgentUsersService,
} from '../admin/agent-users.service';
import type { CreateAgentSalesUserDto } from '../admin/dto/agent-user.dto';

/**
 * Agent Admin team management in the portal (spec §3). Delegation rules
 * live in `AgentTeamService`; this layer only returns the agent-user shape
 * (never the internal user record) and the temporary password exactly once.
 */
@Injectable()
export class AgentPortalTeamService {
  constructor(
    private readonly team: AgentTeamService,
    private readonly agentUsers: AgentUsersService,
  ) {}

  list(agent: AgentRequestContext) {
    return this.team.list(agent);
  }

  async create(agent: AgentRequestContext, dto: CreateAgentSalesUserDto) {
    const created = await this.team.createSalesUser(agent, dto);
    return {
      ...(await this.agentUsers.findOne(agent.agentId, created.id)),
      temporaryPassword: created.temporaryPassword,
    };
  }

  setPermissions(
    agent: AgentRequestContext,
    userId: string,
    permissionNames: AgentPortalPermission[],
  ) {
    return this.team.setSalesUserPermissions(agent, userId, permissionNames);
  }

  setActive(agent: AgentRequestContext, userId: string, isActive: boolean) {
    return this.team.setSalesUserActive(agent, userId, isActive);
  }

  async resetPassword(agent: AgentRequestContext, userId: string) {
    const reset = await this.team.resetSalesUserPassword(agent, userId);
    return {
      ...(await this.agentUsers.findOne(agent.agentId, userId)),
      temporaryPassword: reset.temporaryPassword,
    };
  }
}
