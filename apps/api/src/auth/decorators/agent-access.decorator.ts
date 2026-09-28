import { SetMetadata } from '@nestjs/common';

export const AGENT_ACCESS_KEY = 'agentAccess';

/**
 * `agent-only` — the handler serves external agent users exclusively (the
 * `/agent-portal/*` controllers); internal tokens get 403.
 * `shared` — any authenticated user, internal or agent (own profile, logout,
 * attachment staging). Everything else is internal-only: `JwtAuthGuard`
 * rejects an agent token on any handler without this metadata
 * (deny-by-default, specs/agents-fulfillment-partners §3).
 */
export type AgentAccessMode = 'agent-only' | 'shared';

export const AgentPortal = () =>
  SetMetadata(AGENT_ACCESS_KEY, 'agent-only' satisfies AgentAccessMode);

export const AgentShared = () =>
  SetMetadata(AGENT_ACCESS_KEY, 'shared' satisfies AgentAccessMode);

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';

/**
 * S7 — handlers an agent user may call while `mustChangePassword` is set
 * (own profile, logout, change password). Every other agent request answers
 * 403 MUST_CHANGE_PASSWORD until the temporary password is replaced.
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);
