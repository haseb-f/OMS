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
import { useUiPilot } from "@/providers/ui-pilot-provider";
import type { ReportExportFormat } from "@/lib/report-export";
import { FinancialReportHeaderPilot } from "./pilot/financial-report-header-pilot";

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
 * The financial report header (design-system §11.5) — one compact block:
 * Row 1 = title (h1) + a quiet context line (period · currency · posted-only ·
 * opening balances) with the switcher and actions at the logical end.
 * Row 2 = the one filter row. An optional notice sits under it as a caption
 * line. Purely presentational (the design-system showcase renders it with
 * sample data).
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
  // Round 3 pilot (design-system §12.1): the pilot arrangement, same slots.
  const pilot = useUiPilot().active;
  const parts = context.filter(Boolean);
  if (pilot) {
    return (
      <FinancialReportHeaderPilot
        title={title}
        titleAs={TitleTag}
        context={parts}
        switcher={switcher}
        actions={actions}
        filters={filters}
        notice={notice}
      />
    );
  }
  return (
    <div data-slot="report-header" className="flex min-w-0 flex-col gap-2 print:hidden">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {title ? (
            <TitleTag className="text-ui-title font-semibold tracking-tight text-foreground">
              {title}
            </TitleTag>
          ) : null}
          {parts.length > 0 ? (
            <p
              data-slot="report-context"
              className="flex min-w-0 flex-wrap items-baseline text-caption text-muted-foreground"
            >
              {parts.map((part, index) => (
                <span key={`${index}:${part}`} className="whitespace-nowrap">
                  {index > 0 ? (
                    <span aria-hidden className="px-1.5 text-border-strong">
                      ·
                    </span>
                  ) : null}
                  {/* Isolate each run: a Latin date range ("1 Jan 2026 – 30 Sep
                      2026") inside an RTL line would otherwise have its leading
                      day reordered to the end by the bidi algorithm. */}
                  <bdi>{part}</bdi>
                </span>
              ))}
            </p>
          ) : null}
        </div>
        {switcher || actions ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {switcher}
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
