"use client";

import { useId, useState, type ReactNode } from "react";
import { Filter, PanelTopClose, PanelTopOpen, TriangleAlert } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/** The header's collapse contract (spec-4 §4A) — the report owns the persisted state. */
export interface ReportHeaderCollapse {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Id of a region outside the bar the toggle also shows / hides (the summary strip). */
  controls?: string;
  /** Engaged narrowing filters — the badge on the collapsed strip. */
  filterCount?: number;
  /** Material caveats kept visible while collapsed (unbalanced, drafts, warnings). */
  alerts?: string[];
}

function ContextLine({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <p
      data-slot="report-context"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-y-0.5 text-caption text-muted-foreground",
        className,
      )}
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
  );
}

function CollapseToggle({
  collapsed,
  controls,
  onToggle,
}: {
  collapsed: boolean;
  controls?: string;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const label = collapsed
    ? t("reports.finance.header.expand")
    : t("reports.finance.header.collapse");
  const hint = collapsed
    ? t("reports.finance.header.expandHeader")
    : t("reports.finance.header.collapseHeader");
  // An outline action like its neighbours (export, print); the label shows
  // from `sm` up and stays the accessible name on phones (sr-only).
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          data-report-header-toggle=""
          // A disclosure: "expanded" is its resting state, never drawn pressed.
          data-disclosure=""
          className="max-sm:size-(--control-height-md) max-sm:px-0 aria-expanded:border-(--control-border) aria-expanded:bg-card aria-expanded:not-disabled:hover:bg-(--control-hover)"
          aria-expanded={!collapsed}
          aria-controls={controls}
          onClick={onToggle}
        >
          {collapsed ? (
            <PanelTopOpen data-icon="inline-start" />
          ) : (
            <PanelTopClose data-icon="inline-start" />
          )}
          <span className="max-sm:sr-only">{label}</span>
        </EnterpriseButton>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** The compact caveat badge of the collapsed strip; the list opens on click. */
function AlertBadge({ alerts }: { alerts: string[] }) {
  const { t } = useLocale();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="xs"
          data-slot="report-header-alerts"
          className="shrink-0 text-warning-soft-foreground"
          aria-label={t("reports.finance.header.warningsCount", { count: alerts.length })}
        >
          <TriangleAlert data-icon="inline-start" />
          <EnterpriseBadge variant="warning" className="h-4 min-w-4 px-1">
            <span className="num">{alerts.length}</span>
          </EnterpriseBadge>
        </EnterpriseButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-2 p-3">
        <p className="text-caption font-semibold text-foreground">
          {t("reports.finance.header.warningsTitle")}
        </p>
        <ul className="flex flex-col gap-1.5 text-caption">
          {alerts.map((alert, index) => (
            <li key={`${index}:${alert}`} className="flex items-start gap-1.5">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-warning-soft-foreground"
              />
              <span className="min-w-0 break-words text-foreground">{alert}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The financial report header (design-system §12.5/§12.6):
 * the title with its context line underneath (period · currency · posted-only
 * · opening balances), the switcher and the report actions at the logical
 * end of the same row, then the one filter row. Rendered by
 * `FinancialReportHeader`, which owns the props and slots.
 *
 * With `collapse` (spec-4 §4A, design-system §12.12) the block folds into ONE
 * row of at most 44px: title · period · currency · active-filter badge (opens
 * the filter row) · caveat badge · switcher · actions · expand. No height
 * animation — the swap is instant, so reduced motion needs nothing extra.
 */
export function FinancialReportHeaderBar({
  title,
  titleAs: TitleTag = "h1",
  context = [],
  switcher,
  actions,
  filters,
  notice,
  collapse,
}: {
  title?: string;
  titleAs?: "h1" | "h2" | "h3";
  context?: string[];
  switcher?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  notice?: ReactNode;
  collapse?: ReportHeaderCollapse;
}) {
  const { t } = useLocale();
  const filtersId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const parts = context.filter(Boolean);
  const collapsed = Boolean(collapse?.collapsed);
  const controls = collapse ? [filtersId, collapse.controls].filter(Boolean).join(" ") : undefined;
  const toggle = collapse ? (
    <CollapseToggle
      collapsed={collapsed}
      controls={controls}
      onToggle={() => {
        setFiltersOpen(false);
        collapse.onCollapsedChange(!collapsed);
      }}
    />
  ) : null;
  const endCluster =
    switcher || actions || toggle ? (
      <div className="flex shrink-0 items-center gap-2">
        {switcher}
        {switcher && actions ? (
          <span aria-hidden className="hidden h-5 w-px bg-border md:block" />
        ) : null}
        {actions}
        {toggle}
      </div>
    ) : null;

  if (collapse && collapsed) {
    const filterCount = collapse.filterCount ?? 0;
    const alerts = collapse.alerts ?? [];
    // Period and currency only — the basis / opening flags live in the full header.
    const stripParts = parts.slice(0, 2);
    return (
      <div
        data-slot="report-header"
        data-collapsed=""
        className="flex min-w-0 flex-col gap-2 print:hidden"
      >
        <div className="flex max-h-11 min-h-(--control-height-md) min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-x-3">
            {title ? (
              <TitleTag className="max-w-[60%] min-w-0 shrink-0 truncate text-card-title font-semibold text-foreground">
                {title}
              </TitleTag>
            ) : null}
            {stripParts.length > 0 ? (
              // Phones keep the period (truncated); the currency joins from `sm`.
              <p
                data-slot="report-context"
                className="flex min-w-0 shrink-[2] items-center text-caption text-muted-foreground"
              >
                <bdi className="min-w-0 truncate">{stripParts[0]}</bdi>
                {stripParts[1] ? (
                  <span className="hidden shrink-0 items-center whitespace-nowrap sm:flex">
                    <span aria-hidden className="px-2 text-border-strong">
                      ·
                    </span>
                    <bdi>{stripParts[1]}</bdi>
                  </span>
                ) : null}
              </p>
            ) : null}
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="xs"
              data-slot="report-header-filters"
              className="shrink-0 text-muted-foreground"
              aria-expanded={filtersOpen}
              aria-controls={filtersId}
              aria-label={
                filterCount > 0
                  ? `${t("reports.finance.header.showFilters")} — ${t("table.activeFilterCount", { count: filterCount })}`
                  : t("reports.finance.header.showFilters")
              }
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Filter data-icon="inline-start" />
              {filterCount > 0 ? (
                <EnterpriseBadge variant="info" className="h-4 min-w-4 px-1">
                  <span className="num">{filterCount}</span>
                </EnterpriseBadge>
              ) : null}
            </EnterpriseButton>
            {alerts.length > 0 ? <AlertBadge alerts={alerts} /> : null}
          </div>
          {endCluster}
        </div>
        <div id={filtersId} hidden={!filtersOpen} className="min-w-0">
          {filtersOpen ? filters : null}
        </div>
      </div>
    );
  }

  return (
    <div data-slot="report-header" className="flex min-w-0 flex-col gap-3 print:hidden">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title ? (
            <TitleTag className="text-ui-title font-semibold text-foreground">{title}</TitleTag>
          ) : null}
          {parts.length > 0 ? <ContextLine parts={parts} /> : null}
        </div>
        {endCluster}
      </div>
      <div
        id={filtersId}
        className={cn("flex min-w-0 flex-col gap-3", !filters && !notice && "hidden")}
      >
        {filters}
        {notice ? (
          <div data-slot="report-notice" className="text-caption text-muted-foreground">
            {notice}
          </div>
        ) : null}
      </div>
    </div>
  );
}
