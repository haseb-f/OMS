"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { StatusTone } from "@/components/business/status-tone";
import { Checkbox } from "@/components/ui/checkbox";
import { bidiLineClass } from "@/components/shared/stacked-cell";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";
import { cn } from "@/lib/utils";

/**
 * Workflow tone of a card: a soft tinted surface (the design system's
 * `--*-soft` pairs, no new colours) and a start-edge accent. Colour only
 * reinforces — the state is always also written as a badge label, so the card
 * stays readable without it.
 */
const TONE_SURFACE: Record<StatusTone, string> = {
  success: "border-s-success bg-linear-to-b from-success-soft/70 to-card",
  warning: "border-s-warning bg-linear-to-b from-warning-soft/70 to-card",
  info: "border-s-info bg-linear-to-b from-info-soft/70 to-card",
  destructive: "border-s-destructive bg-linear-to-b from-destructive-soft/70 to-card",
  neutral: "border-s-border-strong bg-linear-to-b from-neutral-soft/60 to-card",
};

export interface RecordGridCardProps {
  /** Workflow tone (see `TONE_SURFACE`). */
  tone: StatusTone;
  selected: boolean;
  onToggleSelected: () => void;
  selectLabel: string;
  /** Customer / record name — the card's primary text and its stretched link. */
  title: ReactNode;
  /** One short line under the title (phone, product). */
  subtitle?: ReactNode;
  /** Record reference (lead number, order number). */
  reference: ReactNode;
  href?: string;
  /** Separate status badges, each answering one question (state, payment, fulfillment). */
  badges: ReactNode;
  /** The one next step, as text with an optional icon — never a second status. */
  nextAction?: { label: string; icon?: LucideIcon; urgent?: boolean } | null;
  nextActionLabel: string;
  /** Muted line at the end of the reference row (date, amount). */
  meta?: ReactNode;
  /** Small marker beside the title ("new to you"). */
  marker?: ReactNode;
  actions?: RowAction[];
  actionsLabel: string;
}

/**
 * The one compact record card of the list "Grid" view (leads, orders — company
 * and agent). Presentation only: callers map their row to these slots, so the
 * same card serves every list and the table/grid views share one row model.
 * Interactive children (checkbox, menu) sit above the title's stretched link.
 */
export function RecordGridCard({
  tone,
  selected,
  onToggleSelected,
  selectLabel,
  title,
  subtitle,
  reference,
  href,
  badges,
  nextAction,
  nextActionLabel,
  meta,
  marker,
  actions,
  actionsLabel,
}: RecordGridCardProps) {
  const NextIcon = nextAction?.icon;
  const titleNode = <bdi className={cn(bidiLineClass, "max-w-full")}>{title}</bdi>;
  return (
    <article
      data-record-card=""
      data-tone={tone}
      data-state={selected ? "selected" : undefined}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-md border border-s-[3px] border-border p-3 shadow-xs group-data-[density=comfortable]/record-grid:gap-3 group-data-[density=comfortable]/record-grid:p-4 transition-colors duration-(--duration-base) ease-(--ease-standard) motion-reduce:transition-none",
        TONE_SURFACE[tone],
        "hover:shadow-sm data-[state=selected]:bg-table-row-selected data-[state=selected]:ring-1 data-[state=selected]:ring-primary/50",
      )}
    >
      <div className="flex min-h-(--control-height-sm) items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected()}
          aria-label={selectLabel}
          className="relative z-10 mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 truncate text-body font-medium text-foreground">
              {href ? (
                <Link
                  href={href}
                  className="rounded-xs outline-none after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
                >
                  {titleNode}
                </Link>
              ) : (
                titleNode
              )}
            </div>
            {marker ? <div className="shrink-0">{marker}</div> : null}
          </div>
          {subtitle ? (
            <div className="min-w-0 truncate text-caption text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        {actions && actions.some((action) => !action.hidden) ? (
          <div className="relative z-10 -my-1 -me-1 shrink-0">
            <RowActionsMenu label={actionsLabel} actions={actions} />
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 items-baseline justify-between gap-2 text-caption text-muted-foreground">
        <div className="min-w-0 truncate">{reference}</div>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1">{badges}</div>

      {nextAction ? (
        <div
          data-next-action=""
          className="flex min-w-0 items-center gap-1.5 border-t border-border/60 pt-2 text-caption"
        >
          {NextIcon ? (
            <NextIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0",
                nextAction.urgent ? "text-destructive" : "text-muted-foreground",
              )}
            />
          ) : null}
          <span className="shrink-0 text-muted-foreground">{nextActionLabel}</span>
          <span
            className={cn(
              "min-w-0 truncate font-medium",
              nextAction.urgent ? "text-destructive" : "text-foreground",
            )}
            title={nextAction.label}
          >
            {nextAction.label}
          </span>
        </div>
      ) : null}
    </article>
  );
}
