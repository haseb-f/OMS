import type {
  AgentRequestContext,
  JwtPayload,
  PartnerRequestContext,
} from '../guards/jwt-auth.guard';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /** Set by JwtAuthGuard for agent tokens only (server-verified affiliation). */
      agentContext?: AgentRequestContext;
      /** R15 — set by JwtAuthGuard for partner tokens only (server-verified link). */
      partnerContext?: PartnerRequestContext;
    }
  }
}

export {};
