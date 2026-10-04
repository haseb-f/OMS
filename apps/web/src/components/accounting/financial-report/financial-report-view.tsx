"use client";

import { type ComponentProps } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { EnterpriseTableViewToggle } from "@/components/shared/data-table/data-table-view-toggle";
import { useTableViewPreference } from "@/components/shared/data-table/table-preferences";
import { useUserContext } from "@/providers/user-context";
import { cn } from "@/lib/utils";
import { FinancialReportCards } from "./financial-report-cards";
import { FinancialReportTable } from "./financial-report-table";

type TableProps = ComponentProps<typeof FinancialReportTable>;

/**
 * A financial report with its Table / Grid switch (design-system §12.19). The
 * Table is the report grid; the Grid is the grouped-card presentation of the SAME
 * lines (`FinancialReportCards`: hierarchy, every amount column, subtotals and
 * totals kept). The choice is remembered per user and per report screen
 * (route + `?report=`), exactly like a list's. Print and export are built from
 * the report's lines, never from this view, so they are unaffected.
 */
export function FinancialReportView({ viewId, ...props }: TableProps & { viewId?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { user } = useUserContext();
  const id = viewId ?? `report:${pathname}:${search?.get("report") ?? ""}`;
  const [view, setView] = useTableViewPreference(id, user?.id);
  const hasLines = props.lines.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-col lg:flex-1">
      {hasLines ? (
        <div className="flex items-center justify-end border-b border-border px-3 py-1 print:hidden">
          <EnterpriseTableViewToggle view={view} onViewChange={setView} />
        </div>
      ) : null}
      {view === "grid" && hasLines ? (
        <div
          className={cn("min-w-0 overflow-auto", props.maxHeightClassName ?? "md:max-h-[70dvh]")}
        >
          <FinancialReportCards
            lines={props.lines}
            columns={props.columns}
            textColumns={props.textColumns}
            expanded={props.expanded}
            onToggle={props.onToggle}
            onPostingClick={props.onPostingClick}
            rowHref={props.rowHref}
            emptyLabel={props.emptyLabel}
            footer={props.footer}
            rowKinds={props.rowKinds}
          />
        </div>
      ) : (
        <FinancialReportTable {...props} />
      )}
    </div>
  );
}
