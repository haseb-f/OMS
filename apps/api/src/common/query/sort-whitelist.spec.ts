import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindJournalEntriesQueryDto } from '../../journal-entries/dto/find-journal-entries-query.dto';
import { FindSalesOrdersQueryDto } from '../../sales/orders/dto/find-sales-orders-query.dto';

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
  ])('%p accepts sortBy=%s', async (dto, field) => {
    expect(await sortErrors(dto, field)).toBe(0);
  });

  it.each([
    [FindJournalEntriesQueryDto, 'journal'],
    [FindJournalEntriesQueryDto, 'lines'],
    [FindSalesOrdersQueryDto, 'partner'],
    [FindSalesOrdersQueryDto, 'nonexistent'],
  ])('%p rejects sortBy=%s', async (dto, field) => {
    expect(await sortErrors(dto, field)).toBe(1);
  });
});
