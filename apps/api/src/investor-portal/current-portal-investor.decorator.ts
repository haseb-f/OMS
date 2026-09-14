import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Extracts the authenticated Portal Investor's `investorId` — set only by
 * `InvestorPortalAuthGuard`. Every portal controller method MUST use this
 * to scope its query; the mission's single most important rule for this
 * module (Part 23/53) is that an `investorId` is NEVER accepted from the
 * request body/query/params for authorization purposes.
 */
export const CurrentPortalInvestor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.portalInvestor!.investorId;
  },
);

/** Same as above but returns the Portal Account id (for `/me`, activation flows, etc.). */
export const CurrentPortalAccountId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.portalInvestor!.portalAccountId;
  },
);
