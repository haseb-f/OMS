import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import type { PartnerPortalPermission } from '../permissions/permission-catalog';
import type { PartnerRequestContext } from '../auth/guards/jwt-auth.guard';

export const PARTNER_PERMISSION_KEY = 'partnerPermission';

/** The `partner.*` permission a portal handler needs. */
export const RequirePartnerPermission = (permission: PartnerPortalPermission) =>
  SetMetadata(PARTNER_PERMISSION_KEY, permission);

function partnerContextOf(request: Request): PartnerRequestContext {
  if (!request.partnerContext) {
    throw new ForbiddenException({
      code: 'PARTNER_CONTEXT_REQUIRED',
      message: 'This endpoint is only for partner users.',
    });
  }
  return request.partnerContext;
}

/**
 * The server-verified partner of the calling login (set by `JwtAuthGuard`
 * for partner tokens only). Portal handlers take the partner from here —
 * never from a route param, query or body field.
 */
export const CurrentPartner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PartnerRequestContext =>
    partnerContextOf(ctx.switchToHttp().getRequest<Request>()),
);

/**
 * Runs after `JwtAuthGuard` on `@PartnerPortal()` controllers (modelled on
 * `AgentPermissionGuard`). A handler without `@RequirePartnerPermission` is
 * refused (fail closed) so a new endpoint can never ship unguarded.
 */
@Injectable()
export class PartnerPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionsResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const partner = partnerContextOf(
      context.switchToHttp().getRequest<Request>(),
    );
    const required = this.reflector.getAllAndOverride<
      PartnerPortalPermission | undefined
    >(PARTNER_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!required) {
      throw new ForbiddenException(
        'No partner permission is registered for this action.',
      );
    }
    if (!(await this.resolver.hasPermission(partner.userId, required))) {
      throw new ForbiddenException({
        code: 'PARTNER_PERMISSION_REQUIRED',
        message: `Missing permission "${required}".`,
      });
    }
    return true;
  }
}
