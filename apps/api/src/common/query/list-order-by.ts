/**
 * Deterministic list ordering (R6 B5): the caller's sort field with an `id`
 * tie-break. Without it, rows sharing a sort value (same `createdAt` on a
 * bulk import, same status) come back in an arbitrary order — offset pages
 * can repeat or skip a row, and "select the first N" is not reproducible.
 * The same order must back the list AND its `/ids` endpoint.
 */
export function listOrderBy(
  query: { sortBy?: string; sortOrder?: 'asc' | 'desc' },
  defaults: { sortBy: string; sortOrder: 'asc' | 'desc' } = {
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
): Record<string, 'asc' | 'desc'>[] {
  const field = query.sortBy || defaults.sortBy;
  const direction = query.sortOrder ?? defaults.sortOrder;
  return field === 'id'
    ? [{ id: direction }]
    : [{ [field]: direction }, { id: direction }];
}
