"use client";

import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { createContext, useContext, type ReactNode } from "react";
import { Download, FoldVertical, MoreHorizontal, Printer, UnfoldVertical } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/providers/locale-provider";
import type { ReportExportFormat } from "@/lib/report-export";
import { FinancialReportHeaderBar } from "./financial-report-header-bar";

/* ------------------------------------------------------------------ */
/* Page chrome: the page that hosts a report hands it the title and the */
/* report switcher, so the report renders ONE header block.            */
/* ------------------------------------------------------------------ */

export interface FinancialReportChrome {
  title: string;
  /** The report switcher (rendered at the logical end of the title row). */
  switcher?: ReactNode;
}

const FinancialReportChromeContext = createContext<FinancialReportChrome | null>(null);

export function FinancialReportChromeProvider({
  value,
  children,
}: {
  value: FinancialReportChrome;
  children: ReactNode;
}) {
  return (
    <FinancialReportChromeContext.Provider value={value}>
      {children}
    </FinancialReportChromeContext.Provider>
  );
}

export function useFinancialReportChrome() {
  return useContext(FinancialReportChromeContext);
}

/* ------------------------------------------------------------------ */
/* Header block                                                         */
/* ------------------------------------------------------------------ */

/**
 * The financial report header (design-system §12.5) — one compact block:
 * the title with its context line (period · currency · posted-only · opening
 * balances), the switcher and actions at the logical end, then the one filter
 * row and an optional caption notice. Purely presentational (the
 * design-system showcase renders it with sample data).
 */
export function FinancialReportHeader({
  title,
  context = [],
  switcher,
  actions,
  filters,
  notice,
  titleAs: TitleTag = "h1",
}: {
  /** Omitted when the host page already has its own h1 (Management P&L tab). */
  title?: string;
  /** Heading element for the title — h1 on a report page; lower in a showcase. */
  titleAs?: "h1" | "h2" | "h3";
  /** Context parts, joined by a middle dot. Only what applies. */
  context?: string[];
  switcher?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  notice?: ReactNode;
}) {
  return (
    <FinancialReportHeaderBar
      title={title}
      titleAs={TitleTag}
      context={context}
      switcher={switcher}
      actions={actions}
      filters={filters}
      notice={notice}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Report switcher                                                      */
/* ------------------------------------------------------------------ */

// Owned by UI-C (usability-financial-reports §3) — lives in its own file.
export { ReportSwitcher, type ReportSwitcherOption } from "./report-switcher";

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

function HeaderIconButton({
  label,
  onClick,
  busy = false,
  children,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          onClick={onClick}
          isLoading={busy}
        >
          {busy ? null : children}
        </EnterpriseButton>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Expand / collapse (a compact icon pair), Export (menu) and Print — on
 * phones one overflow menu carries all of them.
 */
export function FinancialReportActions({
  canExpand,
  onExpandAll,
  onCollapseAll,
  onExport,
  onPrint,
  busy = false,
}: {
  canExpand: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onExport: (format: ReportExportFormat) => void;
  onPrint: () => void;
  /** The full report is being loaded for export / print — both show busy and ignore clicks. */
  busy?: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className="hidden items-center gap-1.5 md:flex">
        {canExpand ? (
          <ButtonGroup
            aria-label={`${t("reports.finance.expandAll")} / ${t("reports.finance.collapseAll")}`}
          >
            <HeaderIconButton label={t("reports.finance.expandAll")} onClick={onExpandAll}>
              <UnfoldVertical />
            </HeaderIconButton>
            <HeaderIconButton label={t("reports.finance.collapseAll")} onClick={onCollapseAll}>
              <FoldVertical />
            </HeaderIconButton>
          </ButtonGroup>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EnterpriseButton type="button" variant="outline" isLoading={busy}>
              {busy ? null : <Download data-icon="inline-start" />}
              {t("table.export")}
              <TriggerChevron kind="menu" />
            </EnterpriseButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => onExport("xlsx")}>
              {t("reportExport.excel")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("csv")}>
              {t("reportExport.csv")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <HeaderIconButton label={t("table.print")} onClick={onPrint} busy={busy}>
          <Printer />
        </HeaderIconButton>
      </div>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EnterpriseButton
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("reports.finance.header.reportActions")}
              isLoading={busy}
            >
              {busy ? null : <MoreHorizontal />}
            </EnterpriseButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {canExpand ? (
              <>
                <DropdownMenuItem onSelect={onExpandAll}>
                  <UnfoldVertical />
                  {t("reports.finance.expandAll")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onCollapseAll}>
                  <FoldVertical />
                  {t("reports.finance.collapseAll")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => onExport("xlsx")}>
              <Download />
              {t("reportExport.excel")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("csv")}>
              <Download />
              {t("reportExport.csv")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPrint}>
              <Printer />
              {t("table.print")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
