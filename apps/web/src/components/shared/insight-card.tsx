import type { ComponentProps, ReactNode } from "react";
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
 */
export function InsightSurface({
  tone = "neutral",
  emphasis = false,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { tone?: InsightTone; emphasis?: boolean }) {
  return (
    <div
      data-slot="insight-card"
      data-tone={tone}
      data-emphasis={emphasis || undefined}
      className={cn("relative flex min-w-0 flex-col rounded-md border px-3 py-2.5", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Compact summary tile (design-system §12.8 / §12.17): a concise label, the
 * figure with its unit on one line, and at most one line of essential
 * context. Round 8: the tone is a clearly visible tinted, glass-like surface
 * with a larger figure; the label carries the meaning, never the colour alone.
 * Only tiles with an `href` are interactive: a resting lift, a chevron, and a
 * restrained hover / keyboard-focus response (rise, tone edge, icon chip fill,
 * figure deepens — the number never changes, nothing reflows). Static
 * summaries stay flat and still, so the two are never confused.
 */
export function InsightCard({
  label,
  value,
  unit,
  context,
  icon: Icon,
  tone = "neutral",
  href,
  actionLabel,
  meta,
  children,
  emphasis = false,
  className,
  direction = "rtl",
  amount,
  keepToneAtZero = false,
  phrase = false,
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
}) {
  const resolvedTone = resolveInsightTone(tone, value, amount, keepToneAtZero);
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  const body = (
    <>
      {/* R15 — the scope chip wraps under the label when the tile is narrow,
          so a label never breaks mid-word around it. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {Icon ? (
          <span
            data-slot="insight-icon"
            className="flex size-7 shrink-0 items-center justify-center rounded-md"
            aria-hidden
          >
            <Icon className="size-4" strokeWidth={2} />
          </span>
        ) : null}
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
            className={cn("text-metric-lg tracking-tight", phrase ? "tabular-nums" : "num")}
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

  const shared = cn("relative flex min-w-0 flex-col rounded-md border px-3 py-2.5", className);

  if (href) {
    return (
      <Link
        href={href}
        data-slot="insight-card"
        data-tone={resolvedTone}
        data-emphasis={emphasis || undefined}
        data-interactive=""
        className={cn(
          shared,
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring",
        )}
      >
        {body}
      </Link>
    );
  }
  return (
    <InsightSurface tone={resolvedTone} emphasis={emphasis} className={className}>
      {body}
    </InsightSurface>
  );
}

/** Loading placeholder with the geometry of an `InsightCard` (no figure is ever faked). */
export function InsightCardSkeleton({ className }: { className?: string }) {
  return (
    <InsightSurface aria-hidden className={cn("gap-2", className)}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-14" />
    </InsightSurface>
  );
}

/** Container-driven columns: one per phone row, otherwise as many ≥ 12rem tiles as the content area fits. */
export const INSIGHT_GROUP_FIT_CLASS =
  "grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]";

/**
 * Related `InsightCard`s as one metric row (design-system §12.8 / §12.13).
 * Round 6: each tile is its own soft, tone-tinted card with an 8px gap — the
 * group itself draws nothing. The caller sets the columns (`grid-cols-*`)
 * and, inside a panel, the inset padding — or passes `fit`: the columns
 * follow the width the group actually gets (sidebar open or not), so long
 * figures never squeeze into vertical text and nothing scrolls sideways.
 */
export function InsightGroup({
  children,
  className,
  fit = false,
  ...props
}: ComponentProps<"div"> & { fit?: boolean }) {
  return (
    <div
      data-slot="insight-group"
      className={cn("grid min-w-0 gap-2", fit && INSIGHT_GROUP_FIT_CLASS, className)}
      {...props}
    >
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
