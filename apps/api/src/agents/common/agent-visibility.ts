import { NotFoundException } from '@nestjs/common';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import type { PermissionsResolverService } from '../../permissions/permissions-resolver.service';

/**
 * Record visibility inside one agent (spec §3): `agent.records.view_all`
 * sees every record of the caller's agent; otherwise only records the user
 * owns (created / assigned). The agent boundary itself is never optional.
 */
export interface AgentVisibility {
  agentId: string;
  userId: string;
  /** null = all of the agent's records. */
  ownerUserId: string | null;
}

export async function resolveAgentVisibility(
  agent: AgentRequestContext,
  resolver: PermissionsResolverService,
): Promise<AgentVisibility> {
  const viewAll = await resolver.hasPermission(
    agent.userId,
    'agent.records.view_all',
  );
  return {
    agentId: agent.agentId,
    userId: agent.userId,
    ownerUserId: viewAll ? null : agent.userId,
  };
}

/** Prisma where-fragment for StoreOrder rows visible to the caller. */
export function agentStoreOrderWhere(v: AgentVisibility) {
  return {
    agentId: v.agentId,
    deletedAt: null,
    ...(v.ownerUserId ? { employeeId: v.ownerUserId } : {}),
  };
}

/** Prisma where-fragment for Lead rows visible to the caller. */
export function agentLeadWhere(v: AgentVisibility) {
  return {
    agentId: v.agentId,
    ...(v.ownerUserId ? { salesEmployeeId: v.ownerUserId } : {}),
  };
}

/** Another agent's record, or one outside the caller's visibility, is simply "not found". */
export function agentNotFound(what = 'Record'): NotFoundException {
  return new NotFoundException({
    code: 'NOT_FOUND',
    message: `${what} not found.`,
  });
}
