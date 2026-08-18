import type { MessageKey } from "@/i18n/translate";

/**
 * Enterprise Table Engine (TASK-036 V2) — the smart column engine every
 * `EnterpriseDataTable` instance runs on, built on top of a real semantic
 * `<table>` (never CSS Grid). Columns declare *intent*
 * (grow/preferredWidth/minWidth/maxWidth/importance/align/type), never a raw
 * pixel width — the engine turns that intent into `<colgroup>` width hints
 * plus a priority-ordered, container-width hide order. No existing column
 * config anywhere in the app has to change: any field left undeclared is
 * inferred from the column id (see `inferColumnType`), so every page that
 * already renders through `EnterpriseDataTable` inherits the engine
 * automatically.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by tanstack's ColumnMeta generic signature
  interface ColumnMeta<TData, TValue> {
    titleKey?: MessageKey;
    /** Two-line cell — skip the table's single-line truncate wrapper. */
    stacked?: boolean;
    /** Relative growth weight when extra space is available — like flexbox `flex-grow`. */
    grow?: number;
    /** An explicit target width in px, converted to a `grow` weight — an alternative to `grow` for callers who'd rather think in pixels. */
    preferredWidth?: number;
    /** Floor width in px this column never goes below. */
    minWidth?: number;
    /** Ceiling width in px this column never grows past, even with free space. */
    maxWidth?: number;
    /** A column with an exact pixel width never grows/shrinks (e.g. a fixed icon column). Selection/Actions size to their content automatically without needing this. */
    fixedWidth?: number;
    /** Header + cell text alignment. */
    align?: "start" | "center" | "end";
    /** Responsive hide order — "low" disappears first as the table narrows, "critical"/"high" never hide. */
    importance?: ColumnImportance;
    /** Escape hatch for the rare column id the type inference can't classify correctly (e.g. a column mixing a code and a date into one string). */
    type?: ColumnType;
  }
}

export type ColumnImportance = "critical" | "high" | "medium" | "low";
export type ColumnAlign = "start" | "center" | "end";
export type ColumnType =
  | "checkbox"
  | "expand"
  | "actions"
  | "code"
  | "status"
  | "date"
  | "money"
  | "number"
  | "name"
  | "description"
  | "default";

export interface ResolvedColumnLayout {
  id: string;
  /** 0 for utility/fixed columns (size to content, never grow) — a positive weight otherwise. */
  grow: number;
  minWidth: number | null;
  maxWidth: number | null;
  fixedWidth: number | null;
  align: ColumnAlign;
  importance: ColumnImportance;
  type: ColumnType;
}

interface ColumnLayoutMeta {
  grow?: number;
  preferredWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  fixedWidth?: number;
  align?: ColumnAlign;
  importance?: ColumnImportance;
  type?: ColumnType;
}

/** One preset per column type — the literal width engine from the spec (Actions/Checkbox fixed, Status/Date/Money/Codes compact, Names flexible, Descriptions maximum-flexible). */
const TYPE_PRESETS: Record<
  Exclude<ColumnType, "checkbox" | "actions" | "expand">,
  {
    grow: number;
    minWidth: number;
    maxWidth: number;
    align: ColumnAlign;
    importance: ColumnImportance;
  }
> = {
  code: { grow: 1, minWidth: 96, maxWidth: 160, align: "start", importance: "medium" },
  status: { grow: 1, minWidth: 90, maxWidth: 140, align: "start", importance: "medium" },
  date: { grow: 1, minWidth: 100, maxWidth: 150, align: "start", importance: "medium" },
  money: { grow: 1, minWidth: 148, maxWidth: 200, align: "end", importance: "medium" },
  number: { grow: 1, minWidth: 90, maxWidth: 130, align: "end", importance: "medium" },
  name: { grow: 3, minWidth: 160, maxWidth: 320, align: "start", importance: "high" },
  description: { grow: 4, minWidth: 200, maxWidth: 560, align: "start", importance: "high" },
  default: { grow: 1.5, minWidth: 120, maxWidth: 240, align: "start", importance: "medium" },
};

/** Ordered keyword classification — first match wins. Status/code/date/money/number are checked before the broader name/description buckets so e.g. "productCode" lands on `code`, not `name`. */
function inferColumnType(columnId: string): ColumnType {
  const id = columnId.toLowerCase();
  if (
    ["status", "state", "tone"].some((k) => id.includes(k)) ||
    id === "type" ||
    id.endsWith("type")
  ) {
    return "status";
  }
  if (
    ["sku", "code", "reference", "ref", "symbol", "barcode", "number"].some((k) => id.includes(k))
  ) {
    return "code";
  }
  if (
    ["date", "expiry", "expiration", "period"].some((k) => id.includes(k)) ||
    columnId.endsWith("At")
  ) {
    return "date";
  }
  if (
    ["price", "cost", "amount", "total", "value", "balance", "rate", "fee"].some((k) =>
      id.includes(k),
    )
  ) {
    return "money";
  }
  if (
    [
      "qty",
      "quantity",
      "count",
      "onhand",
      "reserved",
      "available",
      "stock",
      "days",
      "ratio",
      "index",
      "sequence",
      "displayorder",
      "sortorder",
      "lineorder",
    ].some((k) => id.includes(k))
  ) {
    return "number";
  }
  if (["description", "notes", "address", "remarks", "comment"].some((k) => id.includes(k))) {
    return "description";
  }
  if (
    [
      "name",
      "title",
      "product",
      "customer",
      "supplier",
      "party",
      "warehouse",
      "email",
      "manager",
      "category",
    ].some((k) => id.includes(k))
  ) {
    return "name";
  }
  return "default";
}

const UTILITY_FIXED_WIDTH: Record<"select" | "__expand" | "__actions", number> = {
  select: 44,
  __expand: 44,
  __actions: 88,
};

/** Selection, Expand, and Actions are structural columns — fixed width, never grow. */
function isUtilityColumn(id: string): id is "select" | "__actions" | "__expand" {
  return id === "select" || id === "__actions" || id === "__expand";
}

/** Resolves one column's final layout numbers from its declared meta + id-based type inference — the single source of truth the `<colgroup>` widths, cell styles, truncation, and responsive hide classes all read from. */
export function resolveColumnLayout(
  id: string,
  meta: ColumnLayoutMeta | undefined,
): ResolvedColumnLayout {
  if (isUtilityColumn(id)) {
    const type = id === "__actions" ? "actions" : id === "__expand" ? "expand" : "checkbox";
    const fixedWidth = meta?.fixedWidth ?? UTILITY_FIXED_WIDTH[id];
    return {
      id,
      grow: 0,
      minWidth: fixedWidth,
      maxWidth: fixedWidth,
      fixedWidth,
      align: meta?.align ?? (id === "__actions" ? "end" : "center"),
      importance: "critical",
      type,
    };
  }
  if (meta?.fixedWidth) {
    return {
      id,
      grow: 0,
      minWidth: meta.fixedWidth,
      maxWidth: meta.fixedWidth,
      fixedWidth: meta.fixedWidth,
      align: meta.align ?? "start",
      importance: meta.importance ?? "critical",
      type: meta.type ?? "default",
    };
  }
  const type = meta?.type ?? inferColumnType(id);
  const preset =
    TYPE_PRESETS[type as Exclude<ColumnType, "checkbox" | "actions" | "expand">] ??
    TYPE_PRESETS.default;
  // `preferredWidth` is a px hint expressed on the same relative scale as
  // `grow` (a 300px preference ≈ grow 3) so both can drive the same
  // percentage-of-flexible-space math below.
  const grow = meta?.grow ?? (meta?.preferredWidth ? meta.preferredWidth / 100 : preset.grow);
  return {
    id,
    grow,
    minWidth: meta?.minWidth ?? preset.minWidth,
    maxWidth: meta?.maxWidth ?? preset.maxWidth,
    fixedWidth: null,
    align: meta?.align ?? preset.align,
    importance: meta?.importance ?? preset.importance,
    type,
  };
}

/**
 * `<colgroup>` width hint for one flexible column, as a percentage of the
 * table's own width — proportional to its `grow` share among all
 * currently-visible flexible columns. Prefer `columnGeometryWidth` for
 * `table-layout: fixed`, which mixes px utility columns with calc() flex
 * shares so THEAD and TBODY cannot diverge.
 */
export function columnWidthPercent(
  column: ResolvedColumnLayout,
  columns: ResolvedColumnLayout[],
): number | undefined {
  if (column.fixedWidth != null || column.grow === 0) return undefined;
  const totalGrow = columns.reduce((sum, c) => sum + (c.fixedWidth != null ? 0 : c.grow), 0);
  if (totalGrow <= 0) return undefined;
  return (column.grow / totalGrow) * 100;
}

/**
 * Canonical column width for `<col>` — the only width THEAD and TBODY
 * inherit under `table-layout: fixed`. Utility/fixed columns are px;
 * flexible columns are `minWidth + leftover * grow share`. `max()` is
 * not used: browsers serialize it on `<col>` into invalid CSS, and the
 * width is then ignored.
 */
export function columnGeometryWidth(
  column: ResolvedColumnLayout,
  columns: ResolvedColumnLayout[],
  manualWidths: Record<string, number> = {},
): string {
  const manual = manualWidths[column.id];
  if (manual != null) return `${manual}px`;
  if (column.fixedWidth != null) return `${column.fixedWidth}px`;

  let reservedPx = 0;
  let totalGrow = 0;
  for (const candidate of columns) {
    const resized = manualWidths[candidate.id];
    if (resized != null) {
      reservedPx += resized;
      continue;
    }
    if (candidate.fixedWidth != null) {
      reservedPx += candidate.fixedWidth;
      continue;
    }
    reservedPx += candidate.minWidth ?? 0;
    totalGrow += Math.max(candidate.grow, 0.01);
  }
  if (totalGrow <= 0) return column.minWidth ? `${column.minWidth}px` : "auto";
  const share = Math.max(column.grow, 0.01) / totalGrow;
  const floor = column.minWidth ?? 0;
  return `calc(${floor}px + (100% - ${reservedPx}px) * ${share})`;
}

export function columnSetMinWidth(
  columns: ResolvedColumnLayout[],
  manualWidths: Record<string, number> = {},
): number {
  return columns.reduce((sum, column) => {
    if (manualWidths[column.id] != null) return sum + manualWidths[column.id];
    if (column.fixedWidth != null) return sum + column.fixedWidth;
    return sum + (column.minWidth ?? 0);
  }, 0);
}

/**
 * The Responsive Engine: Tailwind v4 container queries against the table
 * card's own `@container/enterprise-table`, not the viewport — the table
 * sits behind a fixed-width sidebar that pushes content, so its real
 * available width diverges from the viewport, and a viewport breakpoint
 * would hide columns at the wrong moment depending on sidebar state.
 * "low" importance columns hide first (below `@5xl`, ~1024px of the
 * table's own width), "medium" only hides once space is genuinely tight
 * (below `@3xl`, ~768px), and "critical"/"high" columns never carry a hide
 * class at all. Table cells keep their `table-cell` display at the visible
 * breakpoint so hiding a column never breaks the row's table formatting
 * context, and the freed width is immediately reclaimed by the remaining
 * flexible columns rather than left as blank space. If critical+high still
 * can't fit, the table's own `overflow-x-auto` wrapper is the deliberate
 * last resort.
 */
export function responsiveHideClass(importance: ColumnImportance): string {
  switch (importance) {
    case "low":
      return "hidden @5xl/enterprise-table:table-cell";
    case "medium":
      return "hidden @3xl/enterprise-table:table-cell";
    default:
      return "table-cell";
  }
}
