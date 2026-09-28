import {
  createParamDecorator,
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';

/**
 * The server-verified agent affiliation of the calling agent user (set by
 * `JwtAuthGuard` for agent tokens only). Portal handlers take the agent id
 * from here — never from a route param, query or body field.
 */
export const CurrentAgent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AgentRequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.agentContext) {
      throw new ForbiddenException({
        code: 'AGENT_CONTEXT_REQUIRED',
        message: 'This endpoint is only for agent users.',
      });
    }
    return request.agentContext;
  },
);
