export interface ManagedColumnInput {
  header: string;
  values: string[];
}

export interface ManagedColumnWrite {
  header: string;
  columnIndex: number;
  /** Row 1 is the header; remaining cells are values then empty strings to clear stale managed cells. */
  cells: string[];
}

export interface ManagedColumnWritePlan {
  writes: ManagedColumnWrite[];
}

function headerKey(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Plans per-column writes for OMS-managed List Sheet headers.
 *
 * - Resolves columns by trimmed header name (first occurrence wins).
 * - Appends missing managed headers at the end of the header row — never
 *   inserts in the middle, never duplicates an existing header.
 * - Pads each managed column down to the current used-row count so stale
 *   managed values are cleared without touching unmanaged/future columns.
 */
export function planManagedColumnWrites(
  existingGrid: string[][],
  columns: ManagedColumnInput[],
): ManagedColumnWritePlan {
  const headerRow = existingGrid[0] ?? [];
  const usedRowCount = Math.max(1, existingGrid.length);
  const indexByHeader = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const key = headerKey(cell);
    if (key && !indexByHeader.has(key)) indexByHeader.set(key, index);
  });

  let nextIndex = headerRow.length;
  const writes: ManagedColumnWrite[] = [];

  for (const column of columns) {
    const header = headerKey(column.header);
    if (!header) continue;
    let columnIndex = indexByHeader.get(header);
    if (columnIndex === undefined) {
      columnIndex = nextIndex;
      indexByHeader.set(header, columnIndex);
      nextIndex += 1;
    }
    const cells = [header, ...column.values];
    const height = Math.max(usedRowCount, cells.length);
    while (cells.length < height) cells.push('');
    writes.push({ header, columnIndex, cells });
  }

  return { writes };
}
