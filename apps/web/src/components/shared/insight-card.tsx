import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react";
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
 * Insight card (design-system §12.8): a clear label, a prominent value, one
 * line of context and — only when the card leads somewhere — an action. The
 * tone is a restrained accent (icon tile + soft tinted surface); the label
 * and context carry the meaning, never the colour alone. Only cards with an
 * `href` react to hover (border + 1px lift, no layout shift, off under
 * reduced motion); static cards stay still.
 */
export function InsightCard({
  label,
  value,
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
  /** One line that says what the number means (period, currency, basis). */
  context?: ReactNode;
  icon?: LucideIcon;
  tone?: InsightTone;
  href?: string;
  /** Verb phrase for the drill-down, e.g. «مراجعة المدفوعات». Needs `href`. */
  actionLabel?: string;
  /** Small chip at the end of the label row (period, "now", status). */
  meta?: ReactNode;
  /** Optional meaningful mark under the value (e.g. a proportion bar). */
  children?: ReactNode;
  /** Tint the surface with the tone (open work, discrepancies). */
  emphasis?: boolean;
  className?: string;
  direction?: "rtl" | "ltr";
}) {
  const Arrow = direction === "rtl" ? ArrowLeft : ArrowRight;
  const body = (
    <>
      <div className="flex items-start gap-2.5">
        {Icon ? (
          <span
            data-slot="insight-icon"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border"
            aria-hidden
          >
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 pt-0.5 text-caption font-medium text-muted-foreground">
          {label}
        </span>
        {meta ? <span className="shrink-0">{meta}</span> : null}
      </div>
      <div
        data-slot="insight-value"
        className="num mt-2 text-section-title leading-none font-semibold sm:mt-3 sm:text-page-title"
      >
        {value}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
      {context ? (
        <p className="mt-1.5 line-clamp-2 text-caption text-muted-foreground sm:mt-2">{context}</p>
      ) : null}
      {href && actionLabel ? (
        <span
          data-slot="insight-action"
          className="mt-auto flex items-center gap-1.5 pt-3 text-caption font-medium text-foreground"
        >
          {actionLabel}
          <Arrow className="size-3.5 transition-transform duration-(--duration-base) group-hover/insight:translate-x-0.5 rtl:group-hover/insight:-translate-x-0.5 motion-reduce:transition-none" />
        </span>
      ) : null}
    </>
  );

  const shared = cn(
    "group/insight relative flex min-w-0 flex-col rounded-xl border p-3 sm:p-4",
    className,
  );

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

/** A thin, labelled proportion bar (e.g. conversion rate) — real value only. */
export function InsightBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="img"
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        data-slot="insight-bar"
        className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
