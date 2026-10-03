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
 * Compact summary tile (design-system §12.8, Round 3.2): a concise label, the
 * figure with its unit on one line, and at most one line of essential
 * context. The tone is a restrained accent (a small tinted icon; a start-edge
 * accent + tone figure with `emphasis`); the label carries the meaning,
 * never the colour alone. Only tiles with an `href` react to hover and
 * keyboard focus (tone border, faint tint, soft elevation — no transform, no
 * layout shift); static tiles stay still.
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
}) {
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? (
          <span
            data-slot="insight-icon"
            className="flex size-6 shrink-0 items-center justify-center rounded-sm"
            aria-hidden
          >
            <Icon className="size-3.5" strokeWidth={2} />
          </span>
        ) : null}
        {/* Round 6: a label is never truncated — it wraps (labels are kept
            concise; the period / scope lives in the group header). */}
        <span
          data-slot="insight-label"
          className="min-w-0 flex-1 text-caption font-medium text-pretty break-words text-muted-foreground"
        >
          {label}
        </span>
        {meta ? <span className="shrink-0 self-start">{meta}</span> : null}
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            data-slot="insight-value"
            className="num text-metric leading-tight font-semibold tracking-tight"
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
        data-tone={tone}
        data-emphasis={emphasis || undefined}
        data-interactive=""
        className={cn(
          shared,
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        )}
      >
        {body}
      </Link>
    );
  }
  return (
    <div
      data-slot="insight-card"
      data-tone={tone}
      data-emphasis={emphasis || undefined}
      className={shared}
    >
      {body}
    </div>
  );
}

/**
 * Related `InsightCard`s as one metric row (design-system §12.8 / §12.13).
 * Round 6: each tile is its own soft, tone-tinted card with an 8px gap — the
 * group itself draws nothing. The caller sets the columns (`grid-cols-*`)
 * and, inside a panel, the inset padding.
 */
export function InsightGroup({ children, className, ...props }: ComponentProps<"div">) {
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
