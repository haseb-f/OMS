import type { InvestorPortalJwtPayload } from '../investor-portal-jwt.provider';

declare global {
  namespace Express {
    interface Request {
      /**
       * Set only by `InvestorPortalAuthGuard`, never by the internal
       * `JwtAuthGuard`. Deliberately a distinct property from `request.user`
       * (the internal identity) so the two boundaries can never be confused
       * by a handler that reads the wrong one.
       */
      portalInvestor?: InvestorPortalJwtPayload;
    }
  }
}

export {};
