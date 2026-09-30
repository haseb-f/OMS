import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PaymentsController } from './payments.controller';
import { PaymentReconciliationWorkbenchController } from '../payment-reconciliation/payment-reconciliation-workbench.controller';

/**
 * Round 5 spec 3 — the Payments review workbench endpoints carry exactly the
 * permission of the single-record action they wrap (bulk confirm/reject =
 * `sales.receipts.confirm`, like the row actions; bulk-accept =
 * `finance.payment-reconciliation.match`, like Confirm match & post), and a
 * caller without it is refused (403).
 */
type Controller =
  typeof PaymentsController | typeof PaymentReconciliationWorkbenchController;

const CASES: {
  controller: Controller;
  handler: string;
  method: string;
  permission: string;
  others: string[];
}[] = [
  {
    controller: PaymentsController,
    handler: 'reviewSummary',
    method: 'GET',
    permission: 'sales.receipts.view',
    others: ['sales.receipts.confirm', 'finance.payment-reconciliation.view'],
  },
  {
    controller: PaymentsController,
    handler: 'reviewContext',
    method: 'GET',
    permission: 'sales.receipts.view',
    others: ['sales.receipts.confirm'],
  },
  {
    controller: PaymentsController,
    handler: 'bulkConfirm',
    method: 'POST',
    permission: 'sales.receipts.confirm',
    others: ['sales.receipts.view', 'sales.receipts.create'],
  },
  {
    controller: PaymentsController,
    handler: 'bulkReject',
    method: 'POST',
    permission: 'sales.receipts.confirm',
    others: ['sales.receipts.view', 'sales.receipts.cancel'],
  },
  {
    controller: PaymentReconciliationWorkbenchController,
    handler: 'claimLines',
    method: 'GET',
    permission: 'finance.payment-reconciliation.view',
    others: ['sales.receipts.view'],
  },
  {
    controller: PaymentReconciliationWorkbenchController,
    handler: 'bulkAccept',
    method: 'POST',
    permission: 'finance.payment-reconciliation.match',
    others: [
      'finance.payment-reconciliation.view',
      'finance.payment-reconciliation.import',
      'finance.payment-reconciliation.correct',
      'sales.receipts.confirm',
    ],
  },
];

function context(
  controller: Controller,
  handlerName: string,
  method: string,
): ExecutionContext {
  const proto = controller.prototype as unknown as Record<
    string,
    () => unknown
  >;
  return {
    getHandler: () => proto[handlerName],
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ method, user: { sub: 'user-1' } }),
    }),
  } as unknown as ExecutionContext;
}

describe('Payments review workbench permissions', () => {
  it.each(CASES.map((c) => [`${c.controller.name}.${c.handler}`, c] as const))(
    '%s requires its single-record permission',
    async (_name, { controller, handler, method, permission, others }) => {
      const resolver = {
        isSuperAdmin: jest.fn().mockResolvedValue(false),
        hasPermission: jest.fn((_user: string, name: string) =>
          Promise.resolve(name === permission),
        ),
      };
      const guard = new PermissionsGuard(
        new Reflector(),
        resolver as unknown as PermissionsResolverService,
      );
      await expect(
        guard.canActivate(context(controller, handler, method)),
      ).resolves.toBe(true);
      expect(resolver.hasPermission).toHaveBeenCalledWith('user-1', permission);

      resolver.hasPermission.mockImplementation((_user: string, name: string) =>
        Promise.resolve(others.includes(name)),
      );
      await expect(
        guard.canActivate(context(controller, handler, method)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('declares static routes before the `:id` routes they would otherwise collide with', () => {
    const order = Object.getOwnPropertyNames(PaymentsController.prototype);
    const index = (name: string) => order.indexOf(name);
    expect(index('reviewSummary')).toBeGreaterThan(-1);
    expect(index('reviewSummary')).toBeLessThan(index('findOne'));
    expect(index('bulkConfirm')).toBeLessThan(index('confirm'));
    expect(index('bulkReject')).toBeLessThan(index('reject'));
  });
});
