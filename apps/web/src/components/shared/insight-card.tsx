import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  History,
  type LucideIcon,
} from "lucide-react";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type InsightTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "revenue"
  | "expense"
  | "profit"
  | "loss";

/**
 * Colour follows meaning (Round 6): a toned figure that is exactly zero (or
 * empty) carries no signal, so it renders neutral — "With returns 0" is not
 * an alarm. `amount` gives the number when `value` is a formatted node;
 * `keepToneAtZero` opts out where zero is itself the news.
 */
export function resolveInsightTone(
  tone: InsightTone,
  value: ReactNode,
  amount?: number | null,
  keepToneAtZero = false,
): InsightTone {
  if (tone === "neutral" || keepToneAtZero) return tone;
  let numeric: number | null = null;
  if (amount !== undefined) numeric = amount;
  else if (typeof value === "number") numeric = value;
  else if (typeof value === "string") {
    const digits = value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    if (/^[\s%٪.,\-–—0-9]*$/.test(digits)) {
      const cleaned = digits.replace(/[^0-9.-]/g, "");
      numeric = cleaned === "" || cleaned === "-" ? 0 : Number(cleaned);
    }
  } else if (value === null || value === undefined || value === "") numeric = 0;
  return numeric === 0 ? "neutral" : tone;
}

/**
 * The card surface of the dashboard language (design-system §12.8 / §12.17):
 * the tone-tinted, moderately rounded, hairline-bordered box that every
 * summary tile and summary card shares. `InsightCard` is a figure inside it;
 * `SummaryCard` (agent statements, commission report) is a titled list of
 * figures inside it. One surface, so a token change moves them together.
 *
 * R16 S2 — the surface is also the ONE interactive wrapper of the family:
 * `href` renders a link, `onSelect` a button (`pressed` → `aria-pressed`);
 * both carry `data-interactive` and the shared keyboard-focus ring, so every
 * report card that opens something reacts identically to hover and focus
 * (theme/recipes.css "Summary tiles" block). Without either it is a plain,
 * static `div`. Record-grid status cards (`renderGridCard`) are a different
 * family and never use this surface.
 */
export function InsightSurface({
  tone = "neutral",
  emphasis = false,
  size = "default",
  layout = "card",
  identity,
  href,
  onSelect,
  pressed,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "onSelect"> & {
  tone?: InsightTone;
  emphasis?: boolean;
  /**
   * R19 §C — `report`: the sales-report size (`data-size="report"`): the report padding here,
   * the stronger tint / edge / depth / hover tokens in the recipe. Default everywhere else.
   */
  size?: InsightSurfaceSize;
  /**
   * R20 §B2 — `row`: a compact, full-width row of a report card (one period inside an employee
   * card): the compact report padding, `data-layout="row"`. The caller lays its content out.
   */
  layout?: "card" | "row";
  /**
   * R19 §C2 — the card's colour identity (sales-report cards only): the identity hue replaces
   * the tone (`data-tone="identity"` + `data-identity`), so each card of a group reads apart.
   * An identity is not a verdict — it stays at zero. Mapping: components/reports/report-identity.ts.
   */
  identity?: InsightIdentity;
  /** Opens a page: the whole card is one link. */
  href?: string;
  /** Selects something on the page: the whole card is one button. */
  onSelect?: () => void;
  /** With `onSelect`: the card is the current choice. */
  pressed?: boolean;
}) {
  const data = {
    "data-slot": "insight-card",
    "data-tone": identity ? "identity" : tone,
    "data-identity": identity,
    "data-emphasis": emphasis || undefined,
    "data-size": size === "report" ? "report" : undefined,
    "data-layout": layout === "row" ? "row" : undefined,
  } as const;
  const surface = cn(
    INSIGHT_SURFACE_CLASS,
    layout === "row" ? INSIGHT_ROW_PADDING : INSIGHT_SURFACE_PADDING[size],
  );
  if (href) {
    return (
      <Link
        href={href}
        {...data}
        data-interactive=""
        className={cn(surface, INSIGHT_FOCUS_CLASS, className)}
      >
        {children}
      </Link>
    );
  }
  if (onSelect) {
    return (
      <button
        type="button"
        {...data}
        data-interactive=""
        aria-pressed={pressed}
        onClick={onSelect}
        className={cn(surface, "text-start", INSIGHT_FOCUS_CLASS, className)}
      >
        {children}
      </button>
    );
  }
  return (
    <div {...data} className={cn(surface, className)} {...props}>
      {children}
    </div>
  );
}

/** The two surface sizes: every summary card, and the sales-report card (R19 §C). */
export type InsightSurfaceSize = "default" | "report";

/**
 * R19 §C2 — the curated identity hues of the sales-report cards (`--report-identity-*`,
 * theme/tokens.css). Green, amber and red are never identities: they are the semantic text
 * colours (success / attention / danger) inside a card.
 */
export const INSIGHT_IDENTITIES = [
  "teal",
  "sky",
  "blue",
  "indigo",
  "violet",
  "orchid",
  "slate",
] as const;
export type InsightIdentity = (typeof INSIGHT_IDENTITIES)[number];

/** R19 §C2 — the short hover / focus motion of a card's icon (none under reduced motion). */
export type InsightIconMotion = "lift" | "tilt" | "scale";

/**
 * Geometry of every card of the family (visuals come from the theme recipe).
 * R17: ONE padding per size (`--insight-card-padding-*` / R19 `--insight-report-padding-*`,
 * theme/tokens.css) — callers never pad a card locally.
 */
const INSIGHT_SURFACE_CLASS = "relative flex min-w-0 flex-col rounded-md border";
const INSIGHT_SURFACE_PADDING: Record<InsightSurfaceSize, string> = {
  default: "px-(--insight-card-padding-inline) py-(--insight-card-padding-block)",
  report: "px-(--insight-report-padding-inline) py-(--insight-report-padding-block)",
};
/** R20 §B2 — a report row (one period inside an employee card): the compact report padding. */
const INSIGHT_ROW_PADDING =
  "px-(--insight-report-padding-inline-compact) py-(--insight-report-padding-block-compact)";

/**
 * R19 §C — the type and rhythm of a sales-report card (`size="report"`), shared by
 * `InsightCard` and `ReportCard` so both read as one family: a 16px title, a 32px figure
 * (`text-display`), 14px units / secondary lines, and a roomier vertical rhythm.
 */
export const INSIGHT_REPORT_TEXT = {
  title: "text-card-title",
  figure: "text-display",
  unit: "text-body font-medium",
  secondary: "text-body",
  gap: "mt-2.5",
} as const;

/** The keyboard-focus ring of an interactive card — the same for links and buttons. */
export const INSIGHT_FOCUS_CLASS =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring";

/** The tone icon chip at the start of a card's title row (one implementation for every card). */
export function InsightIcon({
  icon: Icon,
  size = "default",
  motion,
}: {
  icon: LucideIcon;
  size?: InsightSurfaceSize;
  /** R19 §C2 — report cards: the icon's own hover / focus motion (theme recipe). */
  motion?: InsightIconMotion;
}) {
  return (
    <span
      data-slot="insight-icon"
      data-motion={motion}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        size === "report" ? "size-9" : "size-7",
      )}
      aria-hidden
    >
      <Icon className={size === "report" ? "size-5" : "size-4"} strokeWidth={2} />
    </span>
  );
}

/**
 * Compact summary tile (design-system §12.8 / §12.17): a concise label, the
 * figure with its unit on one line, and at most one line of essential
 * context. Round 8: the tone is a clearly visible tinted, glass-like surface
 * with a larger figure; the label carries the meaning, never the colour alone.
 * Only tiles with an `href` (a link, with a chevron) or `onSelect` (a filter
 * button) are interactive: a resting lift, a pointer, and a hover /
 * keyboard-focus response (tone shadow, stronger tone edge and tint, icon chip
 * fill, figure deepens — the number never changes, nothing moves or resizes).
 * Informational tiles are plain, unfocusable `div`s: no pointer, no chevron,
 * only a gentle hover tint (R16 S2 / R17 §4), so the two are never confused.
 */
export function InsightCard({
  label,
  value,
  unit,
  context,
  icon: Icon,
  tone = "neutral",
  href,
  onSelect,
  pressed,
  actionLabel,
  meta,
  children,
  emphasis = false,
  className,
  direction = "rtl",
  amount,
  keepToneAtZero = false,
  phrase = false,
  size = "default",
  identity,
  iconMotion,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  /** Muted unit right after the figure (currency code, %, "orders"). */
  unit?: ReactNode;
  /** One line that says what the number means — only when it adds something. */
  context?: ReactNode;
  icon?: LucideIcon;
  tone?: InsightTone;
  href?: string;
  /**
   * R17: the tile selects something on the page (a filter): the whole tile is
   * one button; `pressed` marks the current choice (`aria-pressed` + the
   * emphasis edge). Mutually exclusive with `href`.
   */
  onSelect?: () => void;
  pressed?: boolean;
  /** Verb phrase for the drill-down, e.g. «مراجعة المدفوعات». Needs `href`. */
  actionLabel?: string;
  /** Small chip at the end of the label row (period, status). */
  meta?: ReactNode;
  /** Optional meaningful mark under the value (e.g. a proportion bar). */
  children?: ReactNode;
  /** Open work / discrepancy: start-edge accent and a tone figure. */
  emphasis?: boolean;
  className?: string;
  direction?: "rtl" | "ltr";
  /** The figure as a number when `value` is a formatted node (zero → neutral). */
  amount?: number | null;
  /** Keep the tone even at zero (zero is the meaningful outcome). */
  keepToneAtZero?: boolean;
  /**
   * The value is a phrase with words ("3 من 12", "غير مرتب"), not a bare
   * figure: it keeps the reading direction instead of the left-to-right
   * number run, so Arabic words stay in order.
   */
  phrase?: boolean;
  /**
   * `compact` — dense strips of many figures (detail headers): the figure one
   * step smaller (`text-metric`); surface, padding and states are identical.
   * `report` (R19 §C) — the sales-report card: larger padding, title, figure and
   * secondary lines, stronger tint / edge / depth / hover (`InsightSurface size`).
   */
  size?: "default" | "compact" | "report";
  /** R19 §C2 — report size only: the card's colour identity (replaces the tone). */
  identity?: InsightIdentity;
  /** R19 §C2 — report size only: the icon's hover / focus motion. */
  iconMotion?: InsightIconMotion;
  /** The figure is still loading: the tile's skeleton (no figure is ever faked). */
  loading?: boolean;
}) {
  if (loading) {
    return (
      <InsightCardSkeleton
        context={Boolean(context)}
        size={size === "report" ? "report" : "default"}
        className={className}
      />
    );
  }
  const resolvedTone = resolveInsightTone(tone, value, amount, keepToneAtZero);
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  const report = size === "report";
  const body = (
    <>
      {/* R15 — the scope chip wraps under the label when the tile is narrow,
          so a label never breaks mid-word around it. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {Icon ? (
          <InsightIcon
            icon={Icon}
            size={report ? "report" : "default"}
            motion={report ? iconMotion : undefined}
          />
        ) : null}
        {/* Round 6: a label is never truncated — it wraps (labels are kept
            concise; the period / scope lives in the group header). */}
        <span
          data-slot="insight-label"
          className={cn(
            "min-w-[7rem] flex-1 text-pretty break-words text-muted-foreground",
            report ? INSIGHT_REPORT_TEXT.title : "text-metric-label",
          )}
        >
          {label}
        </span>
        {meta ? <span className="shrink-0 self-start">{meta}</span> : null}
      </div>
      <div
        className={cn(
          report ? INSIGHT_REPORT_TEXT.gap : "mt-1.5",
          "flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-baseline",
            // A report figure keeps its unit beside it, or on the next line — never clipped.
            report ? "flex-wrap gap-x-1.5" : "gap-1.5",
          )}
        >
          <span
            data-slot="insight-value"
            className={cn(
              report
                ? INSIGHT_REPORT_TEXT.figure
                : size === "compact"
                  ? "text-metric"
                  : "text-metric-lg",
              "tracking-tight",
              phrase ? "tabular-nums" : "num",
            )}
          >
            {value}
          </span>
          {unit ? (
            <span
              className={cn(
                "shrink-0 text-muted-foreground",
                report ? INSIGHT_REPORT_TEXT.unit : "text-caption font-medium",
              )}
            >
              {unit}
            </span>
          ) : null}
        </div>
        {href && actionLabel ? (
          <span
            data-slot="insight-action"
            className="flex shrink-0 items-center gap-0.5 text-caption font-medium"
          >
            {actionLabel}
            <Chevron className="size-3.5" aria-hidden />
          </span>
        ) : href ? (
          // A tile that opens something always says so — static summaries never carry it.
          <Chevron data-slot="insight-go" className="size-4 shrink-0" aria-hidden />
        ) : null}
      </div>
      {children ? <div className="mt-1.5">{children}</div> : null}
      {context ? (
        <p
          className={cn(
            "text-muted-foreground",
            report ? `mt-1.5 ${INSIGHT_REPORT_TEXT.secondary}` : "mt-1 text-caption",
            // A report card's explanation always reads in full (it wraps, never clips).
            emphasis || report ? "break-words" : "truncate",
          )}
          title={typeof context === "string" ? context : undefined}
        >
          {context}
        </p>
      ) : null}
    </>
  );

  return (
    <InsightSurface
      tone={resolvedTone}
      size={report ? "report" : "default"}
      identity={report ? identity : undefined}
      emphasis={emphasis || Boolean(onSelect && pressed)}
      href={href}
      onSelect={href ? undefined : onSelect}
      pressed={!href && onSelect ? Boolean(pressed) : undefined}
      className={className}
    >
      {body}
    </InsightSurface>
  );
}

/**
 * Loading placeholder with the geometry of an `InsightCard` (no figure is ever
 * faked); `context` adds the line a tile with a context sentence carries.
 */
export function InsightCardSkeleton({
  className,
  context = false,
  size = "default",
}: {
  className?: string;
  context?: boolean;
  size?: InsightSurfaceSize;
}) {
  const report = size === "report";
  return (
    <InsightSurface aria-hidden size={size} className={cn(report ? "gap-3" : "gap-2", className)}>
      <Skeleton className={report ? "h-5 w-28" : "h-4 w-24"} />
      <Skeleton className={report ? "h-8 w-20" : "h-6 w-14"} />
      {context ? <Skeleton className={report ? "h-4 w-36" : "h-3 w-32"} /> : null}
    </InsightSurface>
  );
}

/** Geometry of the outer card (R20 §B; visuals: the theme recipe, padding / gap: tokens). */
const INSIGHT_FRAME_CLASS =
  "@container/frame relative flex min-w-0 flex-col gap-(--insight-frame-gap) rounded-md border px-(--insight-frame-padding-inline) py-(--insight-frame-padding-block)";
/** R20 §B2 — the rows layout: a subgrid of the `InsightFrameGroup` rows (header + one per row). */
const INSIGHT_FRAME_ROWS_CLASS =
  "@container/frame relative grid min-w-0 grid-rows-subgrid gap-y-(--insight-frame-row-gap) rounded-md border px-(--insight-frame-padding-inline) py-(--insight-frame-padding-block)";

/**
 * R20 §B2 — a group of outer cards compared side by side (employees): one card per row while
 * the group is narrower than 44rem (phones, small tablets), two per row from 44rem (tablet,
 * laptop, desktop) with consistent widths. Cards with `rows` become subgrids of the group's rows,
 * so a pair's headers and its period rows line up row by row (the taller of the two sets the
 * height; nothing is clipped). The group is a container (`@container/frames`).
 */
export function InsightFrameGroup({ children, className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="insight-frame-group-frame"
      className={cn("@container/frames min-w-0", className)}
    >
      <div
        data-slot="insight-frame-group"
        className="grid min-w-0 grid-cols-1 gap-(--insight-frame-group-gap) @min-[44rem]/frames:grid-cols-2"
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * R20 §B — the outer card of the family: ONE soft, opaque card that holds a group of report
 * cards about one subject (an employee × the five Live periods) under a clear identity header —
 * an icon chip in the subject's identity hue, the name (`title`), a quiet reference line
 * (`subtitle`, e.g. the employee code) and an optional meta chip (rank). Visuals come from the
 * theme recipe (`data-slot="insight-frame"`: a faint identity wash at the top, a tinted hairline,
 * a restrained hover / keyboard-focus response — edge + shadow + the header icon's short motion,
 * never a rise, none under reduced motion). The frame is a container (`@container`): the group
 * inside sets its columns by the width the frame gets, never by the viewport. It is an `article`;
 * a caller listing many (a feed) makes each focusable (`tabIndex={0}`) for keyboard reading.
 */
export function InsightFrame({
  title,
  titleId,
  subtitle,
  icon,
  identity,
  iconMotion,
  meta,
  rows,
  surface = "glass",
  children,
  className,
  style,
  ...props
}: Omit<ComponentProps<"article">, "title"> & {
  title: ReactNode;
  /** Id of the title (the article is labelled by it). */
  titleId: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  identity?: InsightIdentity;
  iconMotion?: InsightIconMotion;
  meta?: ReactNode;
  /**
   * R20 §B2 — the children are `rows` full-width rows (one per period). Inside an
   * `InsightFrameGroup` the frame is a subgrid of the group's rows (header + `rows` tracks), so
   * the header and every row line up with the card beside it: each row is as tall as the
   * taller of the pair.
   */
  rows?: number;
  /** R20 §B2 — `opaque`: the report cards inside use the opaque card, no backdrop blur. */
  surface?: "glass" | "opaque";
}) {
  return (
    <article
      data-slot="insight-frame"
      data-identity={identity}
      data-layout={rows ? "rows" : undefined}
      data-surface={surface === "opaque" ? "opaque" : undefined}
      aria-labelledby={titleId}
      className={cn(
        rows ? INSIGHT_FRAME_ROWS_CLASS : INSIGHT_FRAME_CLASS,
        INSIGHT_FOCUS_CLASS,
        className,
      )}
      style={rows ? { gridRow: `span ${rows + 1}`, ...style } : style}
      {...props}
    >
      <header
        data-slot="insight-frame-header"
        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5"
      >
        {icon ? <InsightIcon icon={icon} size="report" motion={iconMotion} /> : null}
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <h2
            id={titleId}
            data-slot="insight-frame-title"
            className="text-card-title font-semibold text-pretty break-words"
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="text-caption break-words text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {meta ? (
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5">{meta}</div>
        ) : null}
      </header>
      {children}
    </article>
  );
}

/** Loading placeholder with an `InsightFrame`'s geometry; the cards inside are their skeletons. */
export function InsightFrameSkeleton({
  children,
  rows,
  className,
}: {
  children?: ReactNode;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      data-slot="insight-frame"
      aria-hidden
      className={cn(rows ? INSIGHT_FRAME_ROWS_CLASS : INSIGHT_FRAME_CLASS, className)}
      style={rows ? { gridRow: `span ${rows + 1}` } : undefined}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-md" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      {children}
    </div>
  );
}

/** Card counts the balanced fit layout is generated for (theme/recipes.css "Balanced fit groups"). */
export const INSIGHT_GROUP_BALANCED_MAX = 12;

/**
 * R17 — the balanced column count of a fit group: `count` cards with room for
 * `room` tiles of 12rem fill ceil(count / room) rows, spread as evenly as
 * possible (6 cards with room for 5 → 3 + 3, never 5 + 1; 5 with room for 4 →
 * 3 + 2). `spanLast`: one card would still be alone on the last row (a prime
 * count in a narrow group) — it then spans that row. The CSS recipe applies
 * exactly this rule per container width (checked by insight-card.spec.tsx).
 */
export function balancedInsightColumns(
  count: number,
  room: number,
): { columns: number; spanLast: boolean } {
  const fit = Math.max(1, Math.min(room, count));
  const rows = Math.ceil(count / fit);
  const columns = Math.ceil(count / rows);
  return { columns, spanLast: columns > 1 && count % columns === 1 };
}

/** The rendered cards of a group (fragments flattened, empty slots skipped). */
function countCards(children: ReactNode): number {
  let count = 0;
  Children.forEach(children, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      count += countCards(child.props.children);
    } else if (child !== null && child !== undefined && typeof child !== "boolean") {
      count += 1;
    }
  });
  return count;
}

/**
 * Related `InsightCard`s as one metric row (design-system §12.8 / §12.13).
 * Round 6: each tile is its own soft, tone-tinted card with an 8px gap — the
 * group itself draws nothing. The caller sets the columns (`grid-cols-*`)
 * and, inside a panel, the inset padding — or passes `fit`: the columns
 * follow the width the group actually gets (sidebar open or not), so long
 * figures never squeeze into vertical text and nothing scrolls sideways.
 *
 * R17: a fit group is also BALANCED — a frame (`insight-group-frame`, the
 * container the recipe queries; it takes the caller's `className`) holds the
 * grid, which carries its card count, so the rows never end on a lone orphan
 * (`balancedInsightColumns`).
 */
export function InsightGroup({
  children,
  className,
  fit = false,
  size = "default",
  surface = "glass",
  ...props
}: ComponentProps<"div"> & {
  fit?: boolean;
  /** R19 §C — `report`: a group of sales-report cards (`size="report"`): a roomier 12px gap. */
  size?: InsightSurfaceSize;
  /**
   * R19 §C — `opaque`: a long, repeated card list (one card per employee / team): its cards
   * use the opaque card colour and no backdrop blur (theme recipe), so a long list never pays
   * for many blurred layers. Small fixed groups keep the glass.
   */
  surface?: "glass" | "opaque";
}) {
  const data = {
    "data-slot": "insight-group",
    "data-size": size === "report" ? "report" : undefined,
    "data-surface": surface === "opaque" ? "opaque" : undefined,
  } as const;
  const gap = size === "report" ? "gap-3" : "gap-2";
  if (fit) {
    const count = countCards(children);
    return (
      <div data-slot="insight-group-frame" className={cn("min-w-0", className)}>
        <div
          {...data}
          data-fit=""
          data-count={count > 0 && count <= INSIGHT_GROUP_BALANCED_MAX ? count : undefined}
          className={cn("grid min-w-0", gap)}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div {...data} className={cn("grid min-w-0", gap, className)} {...props}>
      {children}
    </div>
  );
}

/** A thin, labelled proportion bar (e.g. conversion rate) — real value only. */
export function InsightBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div role="img" aria-label={label} className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        data-slot="insight-bar"
        className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export type InsightScopeKind = "period" | "current" | "toDate";

const SCOPE_ICON: Record<InsightScopeKind, LucideIcon> = {
  period: CalendarRange,
  current: CircleDot,
  toDate: History,
};

/**
 * Says what a group of figures covers (Round 6, design-system §12.13): the
 * selected period («هذا الشهر»), the current state («الآن») or everything to
 * date. Neutral on purpose — the scope is information, not a verdict. Used
 * in panel headers (`DashboardPanel scope`) and, for one figure that differs
 * from its group, in an `InsightCard`'s `meta`.
 */
export function InsightScope({
  kind,
  children,
  className,
}: {
  kind: InsightScopeKind;
  children: ReactNode;
  className?: string;
}) {
  const Icon = SCOPE_ICON[kind];
  return (
    <EnterpriseBadge
      variant="outline"
      data-slot="insight-scope"
      data-scope={kind}
      className={cn("font-medium text-muted-foreground", className)}
    >
      <Icon aria-hidden />
      {children}
    </EnterpriseBadge>
  );
}
