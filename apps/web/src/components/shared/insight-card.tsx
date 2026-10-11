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
  href,
  onSelect,
  pressed,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "onSelect"> & {
  tone?: InsightTone;
  emphasis?: boolean;
  /** Opens a page: the whole card is one link. */
  href?: string;
  /** Selects something on the page: the whole card is one button. */
  onSelect?: () => void;
  /** With `onSelect`: the card is the current choice. */
  pressed?: boolean;
}) {
  const data = {
    "data-slot": "insight-card",
    "data-tone": tone,
    "data-emphasis": emphasis || undefined,
  } as const;
  if (href) {
    return (
      <Link
        href={href}
        {...data}
        data-interactive=""
        className={cn(INSIGHT_SURFACE_CLASS, INSIGHT_FOCUS_CLASS, className)}
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
        className={cn(INSIGHT_SURFACE_CLASS, "text-start", INSIGHT_FOCUS_CLASS, className)}
      >
        {children}
      </button>
    );
  }
  return (
    <div {...data} className={cn(INSIGHT_SURFACE_CLASS, className)} {...props}>
      {children}
    </div>
  );
}

/**
 * Geometry of every card of the family (visuals come from the theme recipe).
 * R17: ONE padding for every report card (`--insight-card-padding-*`,
 * theme/tokens.css) — callers never pad a card locally.
 */
const INSIGHT_SURFACE_CLASS =
  "relative flex min-w-0 flex-col rounded-md border px-(--insight-card-padding-inline) py-(--insight-card-padding-block)";

/** The keyboard-focus ring of an interactive card — the same for links and buttons. */
export const INSIGHT_FOCUS_CLASS =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring";

/** The tone icon chip at the start of a card's title row (one implementation for every card). */
export function InsightIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      data-slot="insight-icon"
      className="flex size-7 shrink-0 items-center justify-center rounded-md"
      aria-hidden
    >
      <Icon className="size-4" strokeWidth={2} />
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
   */
  size?: "default" | "compact";
  /** The figure is still loading: the tile's skeleton (no figure is ever faked). */
  loading?: boolean;
}) {
  if (loading) return <InsightCardSkeleton context={Boolean(context)} className={className} />;
  const resolvedTone = resolveInsightTone(tone, value, amount, keepToneAtZero);
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  const body = (
    <>
      {/* R15 — the scope chip wraps under the label when the tile is narrow,
          so a label never breaks mid-word around it. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {Icon ? <InsightIcon icon={Icon} /> : null}
        {/* Round 6: a label is never truncated — it wraps (labels are kept
            concise; the period / scope lives in the group header). */}
        <span
          data-slot="insight-label"
          className="min-w-[7rem] flex-1 text-metric-label text-pretty break-words text-muted-foreground"
        >
          {label}
        </span>
        {meta ? <span className="shrink-0 self-start">{meta}</span> : null}
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            data-slot="insight-value"
            className={cn(
              size === "compact" ? "text-metric" : "text-metric-lg",
              "tracking-tight",
              phrase ? "tabular-nums" : "num",
            )}
          >
            {value}
          </span>
          {unit ? (
            <span className="shrink-0 text-caption font-medium text-muted-foreground">{unit}</span>
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
            "mt-1 text-caption text-muted-foreground",
            emphasis ? "break-words" : "truncate",
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
}: {
  className?: string;
  context?: boolean;
}) {
  return (
    <InsightSurface aria-hidden className={cn("gap-2", className)}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-14" />
      {context ? <Skeleton className="h-3 w-32" /> : null}
    </InsightSurface>
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
  ...props
}: ComponentProps<"div"> & { fit?: boolean }) {
  if (fit) {
    const count = countCards(children);
    return (
      <div data-slot="insight-group-frame" className={cn("min-w-0", className)}>
        <div
          data-slot="insight-group"
          data-fit=""
          data-count={count > 0 && count <= INSIGHT_GROUP_BALANCED_MAX ? count : undefined}
          className="grid min-w-0 gap-2"
          {...props}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div data-slot="insight-group" className={cn("grid min-w-0 gap-2", className)} {...props}>
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
