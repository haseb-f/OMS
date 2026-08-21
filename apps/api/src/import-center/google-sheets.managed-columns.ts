export interface ManagedColumnInput {
  header: string;
  values: string[];
}

export interface ManagedColumnLayout {
  /** 1-based sheet row that holds managed list headers. */
  headerRow: number;
  /** 1-based first row that may receive synchronized values. */
  dataStartRow: number;
  /** A1 letter of the first column that may hold a managed header. */
  startColumn: string;
}

export interface ManagedColumnWrite {
  header: string;
  columnIndex: number;
  startRow: number;
  /** Data cells only — never includes the header. Trailing empties clear stale values. */
  cells: string[];
}

export interface ManagedHeaderWrite {
  header: string;
  columnIndex: number;
  row: number;
}

export interface ManagedColumnWritePlan {
  writes: ManagedColumnWrite[];
  headerWrites: ManagedHeaderWrite[];
  missingHeaders: string[];
}

function headerKey(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Maps OMS-managed result column names to 0-based indexes in the header
 * row. First trimmed match wins. Headers with surrounding whitespace still
 * resolve — never create a duplicate "Sync Status" column because the
 * existing one had a trailing space.
 */
export function resolveResultColumnIndexes(
  headers: string[],
  columnNames: string[],
): { columnIndexByName: Record<string, number>; missing: string[] } {
  const columnIndexByName: Record<string, number> = {};
  headers.forEach((header, index) => {
    const key = headerKey(header);
    if (!key || !columnNames.includes(key) || key in columnIndexByName) {
      return;
    }
    columnIndexByName[key] = index;
  });
  return {
    columnIndexByName,
    missing: columnNames.filter((name) => !(name in columnIndexByName)),
  };
}

/**
 * Places missing result headers without moving existing named columns.
 * `minStartColumn` keeps a later section (e.g. Shipping Sync X+) from
 * landing in an earlier reserved block (employee T:W) when those cells
 * have no header yet.
 */
export function planMissingResultColumnIndexes(
  headers: string[],
  missingNames: string[],
  minStartColumn?: string,
): Record<string, number> {
  const occupied = new Set<number>();
  headers.forEach((header, index) => {
    if (headerKey(header)) occupied.add(index);
  });
  let nextIndex = minStartColumn
    ? columnLetterToIndex(minStartColumn)
    : headers.length;
  const planned: Record<string, number> = {};
  for (const name of missingNames) {
    while (occupied.has(nextIndex) || headerKey(headers[nextIndex])) {
      nextIndex += 1;
    }
    planned[name] = nextIndex;
    occupied.add(nextIndex);
    nextIndex += 1;
  }
  return planned;
}

export function columnLetterToIndex(letter: string): number {
  const normalized = letter.trim().toUpperCase();
  let index = 0;
  for (const char of normalized) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) return 0;
    index = index * 26 + (code - 64);
  }
  return Math.max(0, index - 1);
}

function nextEmptyColumn(
  headerRow: string[],
  occupied: Set<number>,
  fromIndex: number,
): number {
  let index = fromIndex;
  while (occupied.has(index) || headerKey(headerRow[index])) {
    index += 1;
  }
  return index;
}

/**
 * Plans per-column data writes for OMS-managed List Sheet headers.
 *
 * - Resolves columns by trimmed header name in the configured header row
 *   (first occurrence wins). Never scans or rewrites rows above it.
 * - Never writes the header into the data range.
 * - Never inserts a new row or shifts the existing layout.
 * - If a managed header is missing, it is placed into the next empty cell
 *   of the header row from `startColumn` — never overwriting a filled cell.
 * - Pads each managed column from dataStartRow down to the current used-row
 *   count so stale managed values are cleared without touching unmanaged
 *   columns or rows above dataStartRow.
 */
export function planManagedColumnWrites(
  existingGrid: string[][],
  columns: ManagedColumnInput[],
  layout: ManagedColumnLayout,
): ManagedColumnWritePlan {
  const headerRowIndex = Math.max(0, layout.headerRow - 1);
  const dataStartRow = Math.max(layout.headerRow + 1, layout.dataStartRow);
  const headerRow = [...(existingGrid[headerRowIndex] ?? [])];
  const startColumnIndex = columnLetterToIndex(layout.startColumn);
  const usedRowCount = Math.max(layout.headerRow, existingGrid.length);
  const indexByHeader = new Map<string, number>();
  const occupied = new Set<number>();
  headerRow.forEach((cell, index) => {
    if (index < startColumnIndex) return;
    const key = headerKey(cell);
    if (key && !indexByHeader.has(key)) {
      indexByHeader.set(key, index);
      occupied.add(index);
    }
  });

  const writes: ManagedColumnWrite[] = [];
  const headerWrites: ManagedHeaderWrite[] = [];
  const missingHeaders: string[] = [];
  let nextIndex = startColumnIndex;

  for (const column of columns) {
    const header = headerKey(column.header);
    if (!header) continue;
    let columnIndex = indexByHeader.get(header);
    if (columnIndex === undefined) {
      columnIndex = nextEmptyColumn(headerRow, occupied, nextIndex);
      headerRow[columnIndex] = header;
      indexByHeader.set(header, columnIndex);
      occupied.add(columnIndex);
      nextIndex = columnIndex + 1;
      headerWrites.push({
        header,
        columnIndex,
        row: layout.headerRow,
      });
    }

    const lastManagedRow = Math.max(
      dataStartRow - 1 + column.values.length,
      usedRowCount,
    );
    const height = Math.max(0, lastManagedRow - dataStartRow + 1);
    const cells = column.values.slice();
    while (cells.length < height) cells.push('');
    if (cells.length === 0) continue;
    writes.push({
      header,
      columnIndex,
      startRow: dataStartRow,
      cells,
    });
  }

  return { writes, headerWrites, missingHeaders };
}
