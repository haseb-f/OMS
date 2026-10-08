import { SetMetadata } from '@nestjs/common';

export const PARTNER_ACCESS_KEY = 'partnerAccess';

/**
 * R15 (D15-14) — the company-partner audience, modelled on the agent one.
 * `partner-only` — the handler serves partner logins exclusively (the
 * `/partner-portal/*` controllers); internal and agent tokens get 403.
 * `shared` — any authenticated user incl. a partner login (own profile,
 * logout, change password). Everything else refuses a partner token:
 * `JwtAuthGuard` rejects it on any handler without this metadata
 * (deny-by-default).
 */
export type PartnerAccessMode = 'partner-only' | 'shared';

export const PartnerPortal = () =>
  SetMetadata(PARTNER_ACCESS_KEY, 'partner-only' satisfies PartnerAccessMode);

export const PartnerShared = () =>
  SetMetadata(PARTNER_ACCESS_KEY, 'shared' satisfies PartnerAccessMode);
