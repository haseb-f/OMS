import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PaymentReconciliationController } from './payment-reconciliation.controller';

/**
 * Every reconciliation endpoint resolves to the intended
 * `finance.payment-reconciliation.*` permission through the real
 * PermissionsGuard, and a caller without it is refused (403) — e.g. an
 * importer cannot confirm/post and a matcher cannot correct a posted match.
 */
const EXPECTED: Record<string, { method: string; permission: string }> = {
  listMethods: { method: 'GET', permission: 'view' },
  getMethod: { method: 'GET', permission: 'view' },
  listLines: { method: 'GET', permission: 'view' },
  listImports: { method: 'GET', permission: 'view' },
  awaitingClaims: { method: 'GET', permission: 'view' },
  getSheetSource: { method: 'GET', permission: 'view' },
  suggestions: { method: 'GET', permission: 'view' },
  searchClaims: { method: 'GET', permission: 'match' },
  previewFile: { method: 'POST', permission: 'import' },
  commitFile: { method: 'POST', permission: 'import' },
  createManualLine: { method: 'POST', permission: 'import' },
  previewSheet: { method: 'POST', permission: 'import' },
  connectSheet: { method: 'PUT', permission: 'import' },
  syncSheet: { method: 'POST', permission: 'import' },
  confirmMatch: { method: 'POST', permission: 'match' },
  dismissSuggestion: { method: 'POST', permission: 'match' },
  disputeClaim: { method: 'POST', permission: 'match' },
  ignoreLine: { method: 'POST', permission: 'match' },
  reopenLine: { method: 'POST', permission: 'match' },
  reverseMatch: { method: 'POST', permission: 'correct' },
};

function context(handlerName: string, method: string): ExecutionContext {
  const proto = PaymentReconciliationController.prototype as unknown as Record<
    string,
    () => unknown
  >;
  return {
    getHandler: () => proto[handlerName],
    getClass: () => PaymentReconciliationController,
    switchToHttp: () => ({
      getRequest: () => ({ method, user: { sub: 'user-1' } }),
    }),
  } as unknown as ExecutionContext;
}

describe('PaymentReconciliationController permissions', () => {
  it('covers every handler', () => {
    const handlers = Object.getOwnPropertyNames(
      PaymentReconciliationController.prototype,
    ).filter((name) => name !== 'constructor');
    expect(handlers.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))(
    '%s requires finance.payment-reconciliation.%s',
    async (handler, { method, permission }) => {
      const granted = `finance.payment-reconciliation.${permission}`;
      const resolver = {
        isSuperAdmin: jest.fn().mockResolvedValue(false),
        hasPermission: jest.fn((_user: string, name: string) =>
          Promise.resolve(name === granted),
        ),
      };
      const guard = new PermissionsGuard(
        new Reflector(),
        resolver as unknown as PermissionsResolverService,
      );
      await expect(guard.canActivate(context(handler, method))).resolves.toBe(
        true,
      );
      expect(resolver.hasPermission).toHaveBeenCalledWith('user-1', granted);

      // Every OTHER reconciliation permission is not enough.
      resolver.hasPermission.mockImplementation((_user: string, name: string) =>
        Promise.resolve(
          name.startsWith('finance.payment-reconciliation.') &&
            name !== granted,
        ),
      );
      await expect(
        guard.canActivate(context(handler, method)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
});
