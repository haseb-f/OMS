import type { ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";

/** What a column's `meta.footer` function receives — the rows the totals describe. */
export interface ColumnFooterContext<TData> {
  /**
   * Client mode: every row matching the current search/filters (all pages).
   * Server mode: the rows currently loaded (the current page) — pass a
   * server-computed total as a plain node instead when you need all pages.
   */
  rows: TData[];
}

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
    /**
     * Semantic column type — declare it explicitly. It drives alignment
     * (money/number/percent/quantity → logical end), tabular digits (numeric,
     * date, reference, code, phone), the width preset and the LTR isolation
     * of plain values. Inference from the column id is only a fallback for
     * legacy configs.
     */
    type?: ColumnType;
    /**
     * Column-aligned totals-row cell (rendered in a sticky `<tfoot>` with the
     * same inset/alignment as the body). A node, or a function of the rows
     * the table is showing. The row only renders when a visible column has
     * a footer (or the table gets `footerRow`).
     */
    footer?: ReactNode | ((context: ColumnFooterContext<TData>) => ReactNode);
    /**
     * Marks the column that identifies the record. When the table is given a
     * `getRowHref`, this cell — and only this cell — becomes the link to the
     * record, so navigation stays out of the checkbox, expand and actions
     * columns that share the row.
     */
    identity?: boolean;
    /** Prose columns (error reasons, notes) that must wrap rather than truncate. */
    wrap?: boolean;
  }
}

export type ColumnImportance = "critical" | "high" | "medium" | "low";
export type ColumnAlign = "start" | "center" | "end";
export type ColumnType =
  | "checkbox"
  | "expand"
  | "actions"
  | "code"
  | "phone"
  | "status"
  | "date"
  | "money"
  | "number"
  | "percent"
  | "quantity"
  | "reference"
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
  /** The record's identity column — never hides, never truncates. */
  identity: boolean;
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
  stacked?: boolean;
  identity?: boolean;
}

/**
 * Identity columns (the record's reference) are essential data and never
 * truncate (design-system §6): they get at least this floor — wide enough for
 * a full "LD-2026-010001"-style reference — and never hide.
 */
const IDENTITY_MIN_WIDTH = 164;
const IDENTITY_MAX_WIDTH = 220;
const IDENTITY_MIN_GROW = 1.5;

/**
 * Growth multiplier by importance when a column does not declare its own
 * `grow`: secondary columns take a smaller share of spare width, so they
 * truncate first and the essential columns keep their full values.
 */
const IMPORTANCE_GROW_SCALE: Record<ColumnImportance, number> = {
  critical: 1,
  high: 1,
  medium: 0.75,
  low: 0.5,
};

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
  phone: { grow: 1, minWidth: 120, maxWidth: 180, align: "start", importance: "medium" },
  status: { grow: 1, minWidth: 90, maxWidth: 140, align: "start", importance: "high" },
  date: { grow: 1, minWidth: 110, maxWidth: 160, align: "start", importance: "high" },
  reference: { grow: 1, minWidth: 110, maxWidth: 180, align: "start", importance: "high" },
  money: { grow: 1, minWidth: 148, maxWidth: 200, align: "end", importance: "high" },
  number: { grow: 1, minWidth: 90, maxWidth: 130, align: "end", importance: "medium" },
  quantity: { grow: 1, minWidth: 90, maxWidth: 130, align: "end", importance: "high" },
  percent: { grow: 1, minWidth: 80, maxWidth: 120, align: "end", importance: "medium" },
  name: { grow: 3, minWidth: 160, maxWidth: 320, align: "start", importance: "high" },
  description: { grow: 4, minWidth: 200, maxWidth: 560, align: "start", importance: "high" },
  default: { grow: 1.5, minWidth: 120, maxWidth: 240, align: "start", importance: "medium" },
};

/** Numeric column types — logical end alignment, never truncated. */
const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set(["money", "number", "percent", "quantity"]);

/** Types whose values render with tabular digits (`num`). */
const TABULAR_TYPES: ReadonlySet<ColumnType> = new Set([
  "money",
  "number",
  "percent",
  "quantity",
  "date",
  "reference",
  "code",
  "phone",
]);

export function isNumericColumnType(type: ColumnType | undefined): boolean {
  return type != null && NUMERIC_TYPES.has(type);
}

export function isTabularColumnType(type: ColumnType | undefined): boolean {
  return type != null && TABULAR_TYPES.has(type);
}

/**
 * LEGACY FALLBACK ONLY — columns should declare `meta.type`. Ordered keyword
 * classification — first match wins. Status/code/date/money/number are
 * checked before the broader name/description buckets so e.g. "productCode"
 * lands on `code`, not `name`.
 */
export function inferColumnType(columnId: string): ColumnType {
  const id = columnId.toLowerCase();
  // Label columns that merely contain a numeric keyword ("costCenter",
  // "account", "country", "accountingClass") are names, not figures.
  if (
    /(center|centre|account|accounts)$/.test(id) ||
    id.includes("accounting") ||
    id.includes("country")
  ) {
    return "name";
  }
  // Counts of things ("totalRows", "itemsCount") are numbers even when the
  // id also contains a money keyword such as "total".
  if (/((?<!dis)count|rows|lines)$/.test(id)) {
    return "number";
  }
  if (
    ["status", "state", "tone"].some((k) => id.includes(k)) ||
    id === "type" ||
    id.endsWith("type")
  ) {
    return "status";
  }
  if (["phone", "mobile", "tel"].some((k) => id.includes(k))) {
    return "phone";
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
    [
      "price",
      "cost",
      "amount",
      "total",
      "value",
      "balance",
      "rate",
      "fee",
      "discount",
      "debit",
      "credit",
      "capital",
      "revenue",
      "profit",
    ].some((k) => id.includes(k))
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
      "employee",
      "owner",
      "agent",
      "country",
      "city",
      "source",
      "classification",
    ].some((k) => id.includes(k))
  ) {
    return "name";
  }
  return "default";
}

const UTILITY_FIXED_WIDTH: Record<"select" | "__expand" | "__actions", number> = {
  // Wide enough for the checkbox plus the selection-scope menu's chevron
  // (TASK-064) side by side without crowding.
  select: 52,
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
      identity: false,
    };
  }
  if (meta?.fixedWidth) {
    return {
      id,
      grow: 0,
      minWidth: meta.fixedWidth,
      maxWidth: meta.fixedWidth,
      fixedWidth: meta.fixedWidth,
      align: meta.align ?? (isNumericColumnType(meta.type) ? "end" : "start"),
      importance: meta.importance ?? "critical",
      type: meta.type ?? "default",
      identity: Boolean(meta.identity),
    };
  }
  const type = meta?.type ?? inferColumnType(id);
  const preset =
    TYPE_PRESETS[type as Exclude<ColumnType, "checkbox" | "actions" | "expand">] ??
    TYPE_PRESETS.default;
  // `preferredWidth` is a px hint expressed on the same relative scale as
  // `grow` (a 300px preference ≈ grow 3) so both can drive the same
  // percentage-of-flexible-space math below.
  const identity = Boolean(meta?.identity);
  const stackedCompactType =
    type === "code" ||
    type === "reference" ||
    type === "status" ||
    type === "date" ||
    isNumericColumnType(type);
  const importance: ColumnImportance =
    meta?.importance ??
    (identity ? "critical" : meta?.stacked && stackedCompactType ? "high" : preset.importance);
  const declaredGrow = meta?.grow ?? (meta?.preferredWidth ? meta.preferredWidth / 100 : null);
  const baseGrow = declaredGrow ?? preset.grow * IMPORTANCE_GROW_SCALE[importance];
  const grow = identity ? Math.max(baseGrow, IDENTITY_MIN_GROW) : baseGrow;
  const minWidth = meta?.minWidth ?? preset.minWidth;
  const maxWidth = meta?.maxWidth ?? preset.maxWidth;
  return {
    id,
    grow,
    minWidth: identity ? Math.max(minWidth, IDENTITY_MIN_WIDTH) : minWidth,
    maxWidth: identity ? Math.max(maxWidth, IDENTITY_MAX_WIDTH) : maxWidth,
    fixedWidth: null,
    align: meta?.align ?? preset.align,
    importance,
    type,
    identity,
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

/** Narrowest a secondary column is squeezed to when nothing is known about its header. */
const SHRINK_FLOOR = 72;

/** Types whose values must never be clipped — they keep their full floor. */
const RIGID_TYPES: ReadonlySet<ColumnType> = new Set([
  "money",
  "number",
  "percent",
  "quantity",
  "date",
  "status",
  "code",
  "reference",
  "phone",
]);

export interface ColumnPlan {
  /** px width per shown column (hidden columns are absent). */
  widths: Record<string, number>;
  /** Columns dropped to make the rest fit, lowest importance first. */
  hidden: string[];
  /** Even the rigid floors exceed the container — the table scrolls sideways. */
  overflow: boolean;
}

/**
 * Plans every visible column's px width for the width the table actually
 * has. `<col>` widths that mix `%` and `px` in `calc()` are ignored by
 * Chrome under `table-layout: fixed` (every column then gets an equal
 * share), so once the container is measured the engine hands out plain px.
 *
 * `floors` are measured per locale: a column's translated header (label +
 * sort/menu icons). `contentFloors` are the widest value on the page for
 * identity/code/reference columns. A column's preferred width is the
 * largest of those and its type preset.
 *
 * 1. Too little room: flexible columns shrink toward their floor — low
 *    importance first, then medium, then high text columns (names,
 *    descriptions), and only then references (down to their header/preset
 *    floor). Amounts, dates and statuses never shrink below their floor.
 * 2. Still too little: low-importance columns hide (the last one first),
 *    then medium ones. Identity, utility and critical columns never hide.
 * 3. Still too little: `overflow` — the table scrolls inside its region
 *    (the caller pins the row actions to the logical end).
 * 4. Spare room: shared by `grow` weight up to each `maxWidth`, then among
 *    all flexible columns, so the table always fills its width.
 */
export function planColumnWidths(
  columns: ResolvedColumnLayout[],
  available: number,
  manualWidths: Record<string, number> = {},
  floors: Record<string, number> = {},
  contentFloors: Record<string, number> = {},
): ColumnPlan {
  const exact = (column: ResolvedColumnLayout) =>
    manualWidths[column.id] ?? column.fixedWidth ?? null;
  const measured = (column: ResolvedColumnLayout) => floors[column.id] ?? 0;
  const referenceLike = (column: ResolvedColumnLayout) =>
    column.identity || column.type === "code" || column.type === "reference";
  const preferred = (column: ResolvedColumnLayout) =>
    exact(column) ??
    Math.max(
      column.minWidth ?? 0,
      measured(column),
      referenceLike(column) ? (contentFloors[column.id] ?? 0) : 0,
    );
  const hardFloor = (column: ResolvedColumnLayout) => {
    const fixed = exact(column);
    if (fixed != null) return fixed;
    // A reference keeps its full text while there is room; only as the
    // very last step before overflow does it come down to its preset floor.
    if (referenceLike(column)) return Math.max(column.minWidth ?? 0, measured(column));
    if (RIGID_TYPES.has(column.type)) return preferred(column);
    return Math.min(preferred(column), Math.max(measured(column), SHRINK_FLOOR));
  };
  const hideable = (column: ResolvedColumnLayout) =>
    exact(column) == null &&
    !column.identity &&
    (column.importance === "low" || column.importance === "medium");

  let shown = [...columns];
  const hidden: string[] = [];
  const sumOf = (list: ResolvedColumnLayout[], width: (c: ResolvedColumnLayout) => number) =>
    list.reduce((sum, column) => sum + width(column), 0);
  // Hide until the rigid floors fit: low (last first), then medium.
  for (const importance of ["low", "medium"] as const) {
    for (const column of [...shown].reverse()) {
      if (sumOf(shown, hardFloor) <= available) break;
      if (column.importance !== importance || !hideable(column)) continue;
      shown = shown.filter((candidate) => candidate !== column);
      hidden.push(column.id);
    }
  }

  const widths: Record<string, number> = {};
  for (const column of shown) widths[column.id] = preferred(column);
  const total = () => shown.reduce((sum, column) => sum + widths[column.id], 0);

  // Shrink toward the floors, lowest importance first.
  let deficit = total() - available;
  const tiers: Array<(column: ResolvedColumnLayout) => boolean> = [
    (column) => !referenceLike(column) && column.importance === "low",
    (column) => !referenceLike(column) && column.importance === "medium",
    (column) => !referenceLike(column) && column.importance === "high",
    (column) => referenceLike(column),
  ];
  for (const inTier of tiers) {
    if (deficit <= 0) break;
    const shrinkable = shown.filter(
      (column) => inTier(column) && widths[column.id] > hardFloor(column),
    );
    const room = shrinkable.reduce((sum, column) => sum + widths[column.id] - hardFloor(column), 0);
    if (room <= 0) continue;
    const ratio = Math.min(1, deficit / room);
    for (const column of shrinkable) {
      widths[column.id] -= (widths[column.id] - hardFloor(column)) * ratio;
    }
    deficit -= room * ratio;
  }

  const flexible = shown.filter((column) => exact(column) == null && column.grow > 0);
  let spare = available - total();
  let growing = [...flexible];
  // Water-fill up to each column's ceiling.
  while (spare > 0.5 && growing.length > 0) {
    const totalGrow = growing.reduce((sum, column) => sum + column.grow, 0);
    const capped: ResolvedColumnLayout[] = [];
    let handed = 0;
    for (const column of growing) {
      const offer = (spare * column.grow) / totalGrow;
      const ceiling = Math.max(column.maxWidth ?? Number.POSITIVE_INFINITY, preferred(column));
      const give = Math.min(offer, Math.max(0, ceiling - widths[column.id]));
      widths[column.id] += give;
      handed += give;
      if (give < offer) capped.push(column);
    }
    spare -= handed;
    if (capped.length === 0) break;
    growing = growing.filter((column) => !capped.includes(column));
  }
  // Every column is at its ceiling: the rest still has to go somewhere.
  if (spare > 0.5 && flexible.length > 0) {
    const totalGrow = flexible.reduce((sum, column) => sum + column.grow, 0);
    for (const column of flexible) widths[column.id] += (spare * column.grow) / totalGrow;
  }

  for (const id of Object.keys(widths)) widths[id] = Math.floor(widths[id]);
  return { widths, hidden, overflow: total() > available + 1 };
}

/** Width-only form of {@link planColumnWidths} (no hiding). */
export function fitColumnWidths(
  columns: ResolvedColumnLayout[],
  available: number,
  manualWidths: Record<string, number> = {},
): Record<string, number> {
  return planColumnWidths(columns, available, manualWidths).widths;
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
