"use client";

import type { ReactNode } from "react";

/**
 * Round 3 pilot (design-system §12.5/§12.6) — the financial report header:
 * the title with its context line underneath (period · currency · posted-only
 * · opening balances), the switcher and the report actions at the logical
 * end of the same row, then the one filter row. Same props and slots as the
 * classic `FinancialReportHeader`; only the arrangement differs.
 */
export function FinancialReportHeaderPilot({
  title,
  titleAs: TitleTag = "h1",
  context = [],
  switcher,
  actions,
  filters,
  notice,
}: {
  title?: string;
  titleAs?: "h1" | "h2" | "h3";
  context?: string[];
  switcher?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  notice?: ReactNode;
}) {
  const parts = context.filter(Boolean);
  return (
    <div data-slot="report-header" className="flex min-w-0 flex-col gap-3 print:hidden">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title ? (
            <TitleTag className="text-ui-title font-semibold text-foreground">{title}</TitleTag>
          ) : null}
          {parts.length > 0 ? (
            <p
              data-slot="report-context"
              className="flex min-w-0 flex-wrap items-center gap-y-0.5 text-caption text-muted-foreground"
            >
              {parts.map((part, index) => (
                <span key={`${index}:${part}`} className="flex items-center whitespace-nowrap">
                  {index > 0 ? (
                    <span aria-hidden className="px-2 text-border-strong">
                      ·
                    </span>
                  ) : null}
                  {/* Isolate each run so a Latin date range keeps its order in RTL. */}
                  <bdi>{part}</bdi>
                </span>
              ))}
            </p>
          ) : null}
        </div>
        {switcher || actions ? (
          <div className="flex shrink-0 items-center gap-2">
            {switcher}
            {switcher && actions ? (
              <span aria-hidden className="hidden h-5 w-px bg-border md:block" />
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
      {filters}
      {notice ? (
        <div data-slot="report-notice" className="text-caption text-muted-foreground">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
