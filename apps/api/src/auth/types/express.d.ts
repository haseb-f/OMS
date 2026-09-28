import type { AgentRequestContext, JwtPayload } from '../guards/jwt-auth.guard';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /** Set by JwtAuthGuard for agent tokens only (server-verified affiliation). */
      agentContext?: AgentRequestContext;
    }
  }
}

export {};
