import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindJournalEntriesQueryDto } from '../../journal-entries/dto/find-journal-entries-query.dto';
import { FindSalesOrdersQueryDto } from '../../sales/orders/dto/find-sales-orders-query.dto';
import { FindSalesInvoicesQueryDto } from '../../sales/invoices/dto/find-sales-invoices-query.dto';
import { FindPurchaseInvoicesQueryDto } from '../../purchasing/invoices/dto/find-purchase-invoices-query.dto';
import { FindCustomerReceiptsQueryDto } from '../../financial-transactions/receipts/dto/find-customer-receipts-query.dto';
import { FindSupplierPaymentsQueryDto } from '../../financial-transactions/payments/dto/find-supplier-payments-query.dto';
import { financialTransactionOrderBy } from '../../financial-transactions/shared/find-financial-transactions-query.dto';

/** R6 B review: an unknown `sortBy` is a validation error (400), never a Prisma 500. */
describe('list sortBy whitelists', () => {
  const sortErrors = async (
    dto: new () => object,
    sortBy: string,
  ): Promise<number> => {
    const errors = await validate(plainToInstance(dto, { sortBy }));
    return errors.filter((error) => error.property === 'sortBy').length;
  };

  it.each([
    [FindJournalEntriesQueryDto, 'entryDate'],
    [FindJournalEntriesQueryDto, 'totalDebit'],
    [FindSalesOrdersQueryDto, 'orderNumber'],
    [FindSalesOrdersQueryDto, 'customer'],
    // R22 contract 5 — invoices and receipts / payments.
    [FindSalesInvoicesQueryDto, 'customer'],
    [FindSalesInvoicesQueryDto, 'grandTotal'],
    [FindPurchaseInvoicesQueryDto, 'supplier'],
    [FindPurchaseInvoicesQueryDto, 'invoiceNumber'],
    [FindCustomerReceiptsQueryDto, 'customer'],
    [FindCustomerReceiptsQueryDto, 'amount'],
    [FindSupplierPaymentsQueryDto, 'supplier'],
    [FindSupplierPaymentsQueryDto, 'transactionDate'],
  ])('%p accepts sortBy=%s', async (dto, field) => {
    expect(await sortErrors(dto, field)).toBe(0);
  });

  it.each([
    [FindJournalEntriesQueryDto, 'journal'],
    [FindJournalEntriesQueryDto, 'lines'],
    [FindSalesOrdersQueryDto, 'partner'],
    [FindSalesOrdersQueryDto, 'nonexistent'],
    [FindSalesInvoicesQueryDto, 'partner'],
    [FindSalesInvoicesQueryDto, 'remainingBalance'],
    [FindPurchaseInvoicesQueryDto, 'customer'],
    [FindCustomerReceiptsQueryDto, 'allocations'],
    [FindSupplierPaymentsQueryDto, 'nonexistent'],
  ])('%p rejects sortBy=%s', async (dto, field) => {
    expect(await sortErrors(dto, field)).toBe(1);
  });

  it('voucher party columns sort through the partner relation, ties by id', () => {
    expect(
      financialTransactionOrderBy({ sortBy: 'customer', sortOrder: 'asc' }),
    ).toEqual([{ partner: { name: 'asc' } }, { id: 'asc' }]);
    expect(financialTransactionOrderBy({ sortBy: 'amount' })).toEqual([
      { amount: 'desc' },
      { id: 'desc' },
    ]);
  });
});
