"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  LayoutList,
  MoreHorizontal,
  Printer,
} from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandPopoverContent,
} from "@/components/ui/command";
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

export interface ReportSwitcherOption {
  value: string;
  label: string;
  group?: string;
}

/**
 * Switches to another report of the same family. The trigger never repeats
 * the current report's name (the h1 already says it); the menu marks it
 * with the trailing check.
 */
export function ReportSwitcher({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReportSwitcherOption[];
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const groups: Array<{ heading?: string; items: ReportSwitcherOption[] }> = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.heading === option.group) last.items.push(option);
    else groups.push({ heading: option.group, items: [option] });
  }
  const label = t("reports.finance.header.switchReport");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          aria-label={label}
          aria-haspopup="listbox"
          className="max-md:size-(--control-height-md) max-md:px-0"
        >
          <LayoutList data-icon="inline-start" />
          <span className="max-md:sr-only">{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground max-md:hidden" />
        </EnterpriseButton>
      </PopoverTrigger>
      <CommandPopoverContent align="end" className="min-w-60">
        <Command>
          <CommandList className="max-h-[min(24rem,var(--radix-popover-content-available-height))]">
            {groups.map((group) => (
              <CommandGroup key={group.heading ?? "all"} heading={group.heading}>
                {group.items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    data-checked={option.value === value}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandPopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

function HeaderIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
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
        >
          {children}
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
}: {
  canExpand: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onExport: (format: ReportExportFormat) => void;
  onPrint: () => void;
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
              <ChevronsUpDown />
            </HeaderIconButton>
            <HeaderIconButton label={t("reports.finance.collapseAll")} onClick={onCollapseAll}>
              <ChevronsDownUp />
            </HeaderIconButton>
          </ButtonGroup>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EnterpriseButton type="button" variant="outline">
              <Download data-icon="inline-start" />
              {t("table.export")}
              <ChevronDown className="size-3.5 text-muted-foreground" />
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
        <HeaderIconButton label={t("table.print")} onClick={onPrint}>
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
            >
              <MoreHorizontal />
            </EnterpriseButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {canExpand ? (
              <>
                <DropdownMenuItem onSelect={onExpandAll}>
                  <ChevronsUpDown />
                  {t("reports.finance.expandAll")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onCollapseAll}>
                  <ChevronsDownUp />
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
