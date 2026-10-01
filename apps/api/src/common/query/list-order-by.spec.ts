import { listOrderBy } from './list-order-by';

describe('listOrderBy — deterministic list ordering (R6 B5)', () => {
  it('defaults to newest first with an id tie-break', () => {
    expect(listOrderBy({})).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it("keeps the caller's sort field and direction, then breaks ties by id", () => {
    expect(listOrderBy({ sortBy: 'orderNumber', sortOrder: 'asc' })).toEqual([
      { orderNumber: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('never orders by id twice', () => {
    expect(listOrderBy({ sortBy: 'id', sortOrder: 'asc' })).toEqual([
      { id: 'asc' },
    ]);
  });

  it('honours per-list defaults', () => {
    expect(listOrderBy({}, { sortBy: 'name', sortOrder: 'asc' })).toEqual([
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });
});
