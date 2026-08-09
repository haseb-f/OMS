/**
 * Import Center (TASK-056 Part 4) — a small, dependency-free RFC4180-style
 * CSV parser (quoted fields, embedded commas/newlines, `""` escaping).
 * Deliberately not a library: the Mapping Engine only ever needs "headers +
 * rows of strings," and pulling in a parsing dependency for that is more
 * than this architecture-first phase needs. Excel (.xlsx) support is a
 * clean future addition at this exact seam — `parseCsv` and a future
 * `parseXlsx` would both just produce the same `{ headers, rows }` shape.
 */
export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(content: string): ParsedTable {
  const table = parseCsvRows(content);
  if (table.length === 0) {
    return { headers: [], rows: [] };
  }
  const [headerRow, ...dataRows] = table;
  const headers = headerRow.map((h) => h.trim());
  const rows = dataRows
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = (row[index] ?? '').trim();
      });
      return record;
    });
  return { headers, rows };
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Normalize line endings so \r\n / \r / \n all behave the same.
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
