import { ForbiddenException } from '@nestjs/common';
import { FinancialTransactionType } from '@prisma/client';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import type { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import type { FinancialTransactionsService } from '../financial-transactions.service';
import { ExpensePaymentsController } from './expense-payments.controller';

describe('ExpensePaymentsController — open invoices (R13b)', () => {
  const partnerId = '7b0c6a43-4a1e-4d0b-9a55-3b7f2f5d7a10';
  const user = { sub: 'user-1' } as JwtPayload;

  function build(granted: string[]) {
    const getOpenInvoices = jest.fn().mockResolvedValue([{ invoiceId: 'i' }]);
    const hasPermission = jest.fn((_userId: string, name: string) =>
      Promise.resolve(granted.includes(name)),
    );
    const controller = new ExpensePaymentsController(
      { getOpenInvoices } as unknown as FinancialTransactionsService,
      { hasPermission } as unknown as PermissionsResolverService,
    );
    return { controller, getOpenInvoices, hasPermission };
  }

  it('refuses (403) a user without the Supplier Payments view right — no invoice data is read', async () => {
    const { controller, getOpenInvoices } = build([
      'accounting.expense-payments.view',
    ]);
    await expect(
      controller.openInvoices(user, partnerId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getOpenInvoices).not.toHaveBeenCalled();
  });

  it('lists the open purchase invoices for a user holding purchasing.payments.view', async () => {
    const { controller, getOpenInvoices, hasPermission } = build([
      'accounting.expense-payments.view',
      'purchasing.payments.view',
    ]);
    await expect(controller.openInvoices(user, partnerId)).resolves.toEqual([
      { invoiceId: 'i' },
    ]);
    expect(hasPermission).toHaveBeenCalledWith(
      'user-1',
      'purchasing.payments.view',
    );
    expect(getOpenInvoices).toHaveBeenCalledWith(
      FinancialTransactionType.SUPPLIER_PAYMENT,
      partnerId,
    );
  });
});
