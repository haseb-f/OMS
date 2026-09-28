"use client";

import type { ReactNode, Ref } from "react";

/**
 * Round 3 PILOT (design-system §12.5–12.6) — page anatomy of a commercial
 * document editor in the Vercel-reference design. Presentation only: the
 * editor (`CommercialDocumentEditor`) owns every piece of state, handler,
 * validation and API call and hands the rendered pieces in as slots.
 *
 *   header   title · number · status | meta line            actions (end)
 *   tracker  read-only workflow track(s), when the editor passes one
 *   card     compact proportional header fields
 *   section  product lines (white table on the canvas)
 *   footer   notes / more details (start) | totals on the numeric edge (end)
 *
 * After owner approval this replaces the classic card layout.
 */
export function DocumentEditorPilotLayout({
  bodyRef,
  title,
  documentNumber,
  pendingNumberLabel,
  status,
  meta,
  tracker,
  actions,
  errorSummary,
  fields,
  lines,
  details,
  totals,
  formError,
  related,
}: {
  bodyRef: Ref<HTMLDivElement>;
  title: ReactNode;
  /** The saved number; null before the first save. */
  documentNumber: ReactNode | null;
  /** Shown instead of a number before the first save (numbers are generated on save). */
  pendingNumberLabel: string;
  status?: ReactNode;
  meta?: ReactNode;
  /** Round 3.1: read-only workflow tracker(s) (design-system §12.7), under the header. */
  tracker?: ReactNode;
  actions: ReactNode;
  errorSummary: ReactNode;
  fields: ReactNode;
  lines: ReactNode;
  details: ReactNode;
  totals: ReactNode;
  formError?: ReactNode;
  related?: ReactNode;
}) {
  return (
    <div
      ref={bodyRef}
      data-form-scope=""
      data-slot="document-editor-pilot"
      className="flex min-w-0 flex-col gap-4 pb-20 md:pb-4"
    >
      <header
        data-slot="record-header"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-background pb-3 lg:sticky lg:top-(--shell-topbar-height) lg:z-(--z-sticky) lg:pt-2"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-ui-title font-semibold">{title}</h1>
            {documentNumber ? (
              <span
                dir="ltr"
                className="num rounded-xs border border-border bg-card px-1.5 py-px text-caption font-medium text-muted-foreground"
              >
                {documentNumber}
              </span>
            ) : (
              <span className="rounded-xs border border-dashed border-border-strong px-1.5 py-px text-caption text-muted-foreground">
                {pendingNumberLabel}
              </span>
            )}
            {status}
          </div>
          {meta ? <p className="truncate text-caption text-muted-foreground">{meta}</p> : null}
        </div>
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      </header>

      {tracker ? (
        <div className="rounded-md border border-border bg-card px-4 py-2.5 shadow-(--shadow-card)">
          {tracker}
        </div>
      ) : null}

      {errorSummary}

      <section className="rounded-md border border-border bg-card p-4 shadow-(--shadow-card)">
        {fields}
      </section>

      {lines}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="order-2 flex min-w-0 flex-col gap-1 lg:order-1">{details}</div>
        <div className="order-1 flex min-w-0 flex-col gap-2 lg:order-2">{totals}</div>
      </div>
      {formError}

      {related}
    </div>
  );
}

/** Field grid of the pilot header card: party wide, date/currency/reference narrow. */
export const pilotFieldGridClass =
  "grid grid-cols-2 items-start gap-x-3 gap-y-3 lg:grid-cols-[minmax(0,26rem)_11rem_10rem_12rem]";

/** Per-field spans inside `pilotFieldGridClass`. */
export const pilotFieldClass = {
  wide: "col-span-2 flex min-w-0 flex-col gap-1 lg:col-span-1",
  narrow: "col-span-1 flex min-w-0 flex-col gap-1",
} as const;
