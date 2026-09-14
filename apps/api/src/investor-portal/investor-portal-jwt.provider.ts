import { JwtService } from '@nestjs/jwt';

/**
 * Investor Engine Milestone 4, Part C — a SECOND, independent `JwtService`
 * instance, deliberately never registered as the global `JwtModule` used by
 * `AuthModule`/`JwtAuthGuard`. Signed with `INVESTOR_PORTAL_JWT_SECRET`
 * (never `JWT_SECRET`) so a Portal token structurally cannot be verified by
 * the internal guard, and an internal session token cannot be verified here
 * (mission Part 18/22/52 — "Investor != User", separate external-access
 * boundary). Exposed as a DI token (not a class) because `JwtService` itself
 * is also provided/injected elsewhere with the internal secret — a bare
 * `JwtService` token would collide with that provider.
 */
export const INVESTOR_PORTAL_JWT_SERVICE = 'INVESTOR_PORTAL_JWT_SERVICE';

export interface InvestorPortalJwtPayload {
  portalAccountId: string;
  investorId: string;
  type: 'investor-portal';
}

function resolveSecret(): string {
  const secret = process.env.INVESTOR_PORTAL_JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'INVESTOR_PORTAL_JWT_SECRET must be set in production — refusing to start with an implicit/shared secret for the Investor Portal auth boundary.',
    );
  }
  // Local/test-only fallback — intentionally NOT the same string as any
  // internal JWT_SECRET fallback, so the two token universes stay disjoint
  // even if both env vars are left unset.
  return 'oms-dev-only-investor-portal-secret-do-not-use-in-production';
}

export const investorPortalJwtServiceProvider = {
  provide: INVESTOR_PORTAL_JWT_SERVICE,
  useFactory: () =>
    new JwtService({
      secret: resolveSecret(),
      signOptions: {
        expiresIn: (process.env.INVESTOR_PORTAL_JWT_TTL ??
          '7d') as `${number}d`,
      },
    }),
};
