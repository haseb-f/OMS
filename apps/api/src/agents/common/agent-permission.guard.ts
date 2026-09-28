import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import type { AgentPortalPermission } from '../../permissions/permission-catalog';

export const AGENT_PERMISSION_KEY = 'agentPermission';

export const AGENT_PERMISSION_ANY_KEY = 'agentPermissionAny';

/** Every listed `agent.*` permission is required (all-of). */
export const RequireAgentPermission = (
  ...permissions: AgentPortalPermission[]
) => SetMetadata(AGENT_PERMISSION_KEY, permissions);

/** At least one listed `agent.*` permission is required (any-of). */
export const RequireAnyAgentPermission = (
  ...permissions: AgentPortalPermission[]
) => SetMetadata(AGENT_PERMISSION_ANY_KEY, permissions);

/**
 * Runs after `JwtAuthGuard` on `@AgentPortal()` controllers. A portal handler
 * without `@RequireAgentPermission` is refused (fail closed) so a new endpoint
 * can never ship unguarded.
 */
@Injectable()
export class AgentPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionsResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const agent = request.agentContext;
    if (!agent) {
      throw new ForbiddenException({
        code: 'AGENT_CONTEXT_REQUIRED',
        message: 'This endpoint is only for agent users.',
      });
    }
    const anyOf = this.reflector.getAllAndOverride<
      AgentPortalPermission[] | undefined
    >(AGENT_PERMISSION_ANY_KEY, [context.getHandler(), context.getClass()]);
    if (anyOf?.length) {
      for (const permission of anyOf) {
        if (await this.resolver.hasPermission(agent.userId, permission)) {
          return true;
        }
      }
      throw new ForbiddenException({
        code: 'AGENT_PERMISSION_REQUIRED',
        message: `Missing one of: ${anyOf.join(', ')}.`,
      });
    }
    const required = this.reflector.getAllAndOverride<
      AgentPortalPermission[] | undefined
    >(AGENT_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    // Fail closed: no requirement, or an empty one, never grants access.
    if (!required?.length) {
      throw new ForbiddenException(
        'No agent permission is registered for this action.',
      );
    }
    for (const permission of required) {
      if (!(await this.resolver.hasPermission(agent.userId, permission))) {
        throw new ForbiddenException({
          code: 'AGENT_PERMISSION_REQUIRED',
          message: `Missing permission "${permission}".`,
        });
      }
    }
    return true;
  }
}
