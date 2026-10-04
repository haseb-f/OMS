"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { StatusTone } from "@/components/business/status-tone";
import { Checkbox } from "@/components/ui/checkbox";
import { bidiLineClass } from "@/components/shared/stacked-cell";
import { RowActionsMenu, type RowAction } from "./row-actions-menu";
import { cn } from "@/lib/utils";

export interface RecordGridCardField {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Money / quantity: tabular digits on the numeric (logical end) edge. */
  numeric?: boolean;
}

export interface RecordGridCardProps {
  /**
   * Workflow tone of the card (the recipe `[data-record-card]` in
   * theme/recipes.css: a soft tinted surface, a delicate tone hairline and a
   * start-edge accent). Colour only reinforces — every state is also written as
   * a badge label, so the card reads without it.
   */
  tone: StatusTone;
  selected: boolean;
  /** Omit on a list that has no selection — the checkbox is not drawn. */
  onToggleSelected?: () => void;
  selectLabel?: string;
  /**
   * The record's accessible name — "customer — number". Names the card (`aria-label`), so ten
   * invoices of one customer never read alike; pass it with the record number.
   */
  recordLabel?: string;
  /** Customer / record name — the card's primary text and its stretched link. */
  title: ReactNode;
  /** One short line under the title (phone, product). */
  subtitle?: ReactNode;
  /** Record reference (lead number, order number). */
  reference: ReactNode;
  href?: string;
  /** Separate status badges, each answering one question (state, payment, fulfillment). */
  badges?: ReactNode;
  /**
   * A short label/value block (at most four — the rest stays in the table).
   * Secondary information, laid out two to a row.
   */
  fields?: RecordGridCardField[];
  /** The one next step, as text with an optional icon — never a second status. */
  nextAction?: { label: string; icon?: LucideIcon; urgent?: boolean } | null;
  nextActionLabel?: string;
  /** Muted line at the end of the reference row (date, amount). */
  meta?: ReactNode;
  /** Small marker beside the title ("new to you"). */
  marker?: ReactNode;
  /** Row actions, as the shared kebab menu... */
  actions?: RowAction[];
  /** ...or an already-rendered actions control (the table's own actions cell). */
  actionsNode?: ReactNode;
  actionsLabel?: string;
  /** Extra footer content (due date, owner) under the optional next action. */
  footer?: ReactNode;
}

/**
 * The one record card of the list "Grid" view (design-system §12.19): a
 * deliberate header (selection, identity, actions), a concise body (reference
 * and key figure, up to four label/value fields, status badges) and a footer
 * (next action). Presentation only — callers map their row to these slots, so
 * every list shares one foundation and the table/grid views share one row model.
 *
 * Interaction (Carbon "selectable tile" rule): the card has ONE primary link, the
 * title, stretched over the card by a pseudo-element; the checkbox and the kebab
 * sit above it (`z-10`), so there are no nested anchors and a click on a control
 * never opens the record. Hover, keyboard focus and selection are three distinct
 * treatments in the recipe.
 */
export function RecordGridCard({
  tone,
  selected,
  onToggleSelected,
  selectLabel,
  recordLabel,
  title,
  subtitle,
  reference,
  href,
  badges,
  fields,
  nextAction,
  nextActionLabel,
  meta,
  marker,
  actions,
  actionsNode,
  actionsLabel,
  footer,
}: RecordGridCardProps) {
  const NextIcon = nextAction?.icon;
  const referenceId = useId();
  const titleNode = <bdi className={cn(bidiLineClass, "max-w-full")}>{title}</bdi>;
  // A field with nothing to say ("—", empty) is noise on a card — the table keeps the column.
  const shownFields = (fields ?? [])
    .filter(
      (field) =>
        field.value !== null &&
        field.value !== undefined &&
        field.value !== false &&
        field.value !== "" &&
        field.value !== "—",
    )
    .slice(0, 4);
  const hasActions =
    Boolean(actionsNode) || Boolean(actions && actions.some((action) => !action.hidden));
  return (
    <article
      data-record-card=""
      data-tone={tone}
      data-state={selected ? "selected" : undefined}
      aria-label={recordLabel}
      className="relative flex h-full min-w-0 flex-col gap-2 p-3 group-data-[density=comfortable]/record-grid:gap-3 group-data-[density=comfortable]/record-grid:p-4"
    >
      <div className="flex min-h-(--control-height-sm) items-start gap-2">
        {onToggleSelected ? (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected()}
            aria-label={selectLabel}
            className="relative z-10 mt-0.5 shrink-0 after:absolute after:-inset-3 after:content-['']"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 truncate text-body font-medium text-foreground">
              {href ? (
                <Link
                  href={href}
                  data-record-link=""
                  aria-describedby={reference ? referenceId : undefined}
                  className="rounded-xs outline-none after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
                >
                  {titleNode}
                </Link>
              ) : (
                titleNode
              )}
            </div>
          </div>
          {subtitle ? (
            <div className="min-w-0 truncate text-caption text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        {hasActions ? (
          <div className="relative z-10 -my-1 -me-1 shrink-0">
            {actionsNode ??
              (actions ? <RowActionsMenu label={actionsLabel ?? ""} actions={actions} /> : null)}
          </div>
        ) : null}
      </div>

      {reference ? (
        <div
          id={referenceId}
          className="min-w-0 text-caption text-muted-foreground [overflow-wrap:anywhere]"
        >
          {reference}
        </div>
      ) : null}
      {meta ? (
        <div
          data-record-figure=""
          className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-table font-semibold text-foreground tabular-nums"
        >
          {meta}
        </div>
      ) : null}

      {shownFields.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {shownFields.map((field) => (
            <div
              key={field.key}
              className={cn(
                "min-w-0",
                field.numeric && "text-end",
                shownFields.length === 1 && "col-span-2",
              )}
            >
              <dt className="truncate text-micro text-muted-foreground">{field.label}</dt>
              <dd
                className={cn(
                  "min-w-0 text-table text-foreground",
                  field.numeric
                    ? "tabular-nums whitespace-nowrap"
                    : "line-clamp-2 [overflow-wrap:anywhere]",
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {badges || marker ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {marker}
          {badges}
        </div>
      ) : null}

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
          {nextActionLabel ? (
            <span className="shrink-0 text-muted-foreground">{nextActionLabel}</span>
          ) : null}
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
      {footer ? (
        <div className="min-w-0 border-t border-border/60 pt-2 text-caption text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </article>
  );
}
