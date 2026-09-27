"use client";

import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import {
  DocumentLineTable,
  DocumentLineTableAddFooter,
  DocumentLineTableBody,
  DocumentLineTableCell,
  DocumentLineTableHead,
  DocumentLineTableHeader,
  DocumentLineTableRow,
  documentLineCellClass,
  documentLineHeadClass,
  documentLineNumericCellClass,
  documentLineNumericHeadClass,
  lineColumnsWidth,
  type LineColumnWidth,
} from "@/components/documents/document-line-table";
import { DocumentTotalsBlock } from "@/components/documents/document-totals";
import { journalBalance } from "@/components/documents/document-totals-math";
import { StatusBadge } from "@/components/business/status-badge";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/shared/money-input";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { AccountPicker } from "@/components/business/account-picker";
import { CostCenterPicker } from "@/components/business/cost-center-picker";
import { ProjectPicker } from "@/components/business/project-picker";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { useIsMobile } from "@/hooks/use-mobile";
import { useElementWidth } from "@/hooks/use-element-width";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { ChartOfAccountRow, CostCenterRow, ProjectRow } from "@/config/master-data/entities";
import { partnersService } from "@/services/partners-service";
import { cachedLookup } from "@/lib/lookup-cache";

/** Slim projection — matches both `JournalEntryRow["lines"][number].partner` (server include) and a full `PartnerRow` from the picker's search results. */
type LinePartner = { id: string; partnerNumber: string; name: string };

/** Slim account projection the server includes on a saved line (`{id, code, name}`). */
type LineAccount = { id: string; code: string; name: string };

/**
 * Display-only row for a line whose account is neither in the prefetched map
 * nor picked in this session (e.g. an existing entry's account beyond the
 * prefetch page). A selected combobox value only ever renders `getTitle`
 * (the name); search results always come back as full rows from the API.
 */
function slimAccountRow(account: LineAccount): ChartOfAccountRow {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    description: null,
    accountType: "ASSET",
    parentAccountId: null,
    currencyId: null,
    allowReconciliation: false,
    level: 0,
    allowsPosting: true,
    isSystemAccount: false,
    deletedAt: null,
  };
}

let nextLineId = 1;

/**
 * Debit/credit columns must fit 10+ digit amounts: the price token x 1.5
 * (same scale, same reason as ProductLineItemsGrid's amount columns).
 */
const AMOUNT_WIDTH = "w-(--width-control-price)";
const AMOUNT_COLUMN: LineColumnWidth = ["--width-control-price", 1];
/** Partner picker column; cost center/project columns are narrower still. */
const PARTNER_WIDTH = "w-(--width-control-date)";
const ATTRIBUTION_WIDTH = "w-(--width-control-tax)";

/**
 * Column budgets (minimum widths) for the two table layouts. The account and
 * description columns carry no fixed width — they share whatever the
 * container has left over — so these budgets use their minimums.
 *
 * - `full`: every column inline (wide desktop).
 * - `compact`: cost center/project move behind a per-line disclosure, so the
 *   table still fits a laptop with the sidebar open.
 * Below the compact budget the grid becomes line cards (design-system §8).
 */
const BASE_COLUMNS: LineColumnWidth[] = [
  "--width-control-product-min",
  "--width-control-tax",
  "--width-control-date",
  AMOUNT_COLUMN,
  AMOUNT_COLUMN,
  "--width-control-actions",
];
const ATTRIBUTION_COLUMNS: LineColumnWidth[] = ["--width-control-tax", "--width-control-tax"];
const DISCLOSURE_COLUMNS: LineColumnWidth[] = ["--width-control-actions"];

type GridLayout = "full" | "compact" | "cards";

export interface JournalEntryLineGridRow {
  /** Client-side row identity — never the DB line id at this layer (mirrors AllocationGridLine.id). */
  id: string;
  accountId: string;
  /** Optional slim account (from a saved line) — lets the row show its account even when it is outside the prefetched `accounts` list. */
  account?: LineAccount | null;
  description: string;
  /** TASK-053 — per-line cost attribution, distinct from the (still-unused) header-level JournalEntry.costCenterId/projectId. */
  costCenterId: string;
  projectId: string;
  /** Unified Partner Architecture — required whenever `accountId` resolves to a RECEIVABLE/PAYABLE control account (backend-enforced in `resolveLines()`). */
  partnerId: string;
  partner: LinePartner | null;
  debit: number;
  credit: number;
}

/**
 * Accounting Foundation (TASK-044 Part 6) — the editable debit/credit line
 * table for a Manual Journal Entry. Each line is either a debit OR a credit
 * (never both), same "editable grid, add rows from elsewhere or a button"
 * shape as AllocationGrid/ProductLineItemsGrid.
 */
export function JournalEntryLinesGrid({
  lines,
  accounts,
  costCenters,
  projects,
  onChange,
  disabled,
  currency,
}: {
  lines: JournalEntryLineGridRow[];
  /**
   * Prefetched accounts used only to DISPLAY existing lines. The account
   * picker itself always searches the server (posting accounts only, cached
   * via `cachedLookup`), so accounts beyond this page stay findable.
   */
  accounts: ChartOfAccountRow[];
  /** Omit to hide the Cost Center/Project columns entirely (e.g. the Opening Balance Wizard, which has no per-line cost attribution). */
  costCenters?: CostCenterRow[];
  projects?: ProjectRow[];
  onChange: (lines: JournalEntryLineGridRow[]) => void;
  disabled?: boolean;
  /** Currency code shown beside the debit/credit totals. */
  currency?: string | null;
}) {
  const { t } = useLocale();
  const showCostAttribution = costCenters !== undefined && projects !== undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const containerWidth = useElementWidth(containerRef);
  // Accounts picked from a remote search in this session, so a pick that is
  // not in the prefetched list keeps showing its name.
  const [pickedAccounts, setPickedAccounts] = useState<Record<string, ChartOfAccountRow>>({});
  const accountById = useMemo(() => {
    const map = new Map<string, ChartOfAccountRow>(Object.entries(pickedAccounts));
    for (const account of accounts) map.set(account.id, account);
    return map;
  }, [accounts, pickedAccounts]);
  const resolveAccount = (line: JournalEntryLineGridRow): ChartOfAccountRow | null => {
    if (!line.accountId) return null;
    const known = accountById.get(line.accountId);
    if (known) return known;
    return line.account?.id === line.accountId ? slimAccountRow(line.account) : null;
  };

  // Lines whose cost center/project disclosure is open (compact layout only).
  const [expandedLines, setExpandedLines] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpandedLines((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Cards take over only when even the compact table would clip, so the grid
  // never needs a sideways scroll (design-system §8: on phones the grid
  // becomes line cards). Until the container is measured, assume the table.
  const layout: GridLayout = (() => {
    if (isMobile) return "cards";
    if (containerWidth === null) return showCostAttribution ? "compact" : "full";
    if (!showCostAttribution) {
      return containerWidth < lineColumnsWidth(BASE_COLUMNS) ? "cards" : "full";
    }
    if (containerWidth >= lineColumnsWidth([...BASE_COLUMNS, ...ATTRIBUTION_COLUMNS])) {
      return "full";
    }
    return containerWidth >= lineColumnsWidth([...BASE_COLUMNS, ...DISCLOSURE_COLUMNS])
      ? "compact"
      : "cards";
  })();
  const inlineAttribution = showCostAttribution && layout === "full";
  const disclosedAttribution = showCostAttribution && layout === "compact";
  const columnCount = 6 + (inlineAttribution ? 2 : 0) + (disclosedAttribution ? 1 : 0);

  const updateLine = (id: string, patch: Partial<JournalEntryLineGridRow>) => {
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLine = (id: string) => {
    onChange(lines.filter((line) => line.id !== id));
  };

  const balance = journalBalance(lines);
  const { difference } = balance;

  /** "Auto balancing while typing" (Odoo-style) — a new line pre-fills whichever side clears the current outstanding difference, so a balanced entry is usually just "add line, pick account, Enter." */
  const addLine = () => {
    const newLine: JournalEntryLineGridRow = {
      id: `row-${nextLineId++}`,
      accountId: "",
      description: "",
      costCenterId: "",
      projectId: "",
      partnerId: "",
      partner: null,
      debit: difference < -0.001 ? Math.abs(difference) : 0,
      credit: difference > 0.001 ? difference : 0,
    };
    onChange([...lines, newLine]);
  };

  /** Spreadsheet-style Enter/arrow navigation between debit/credit cells — mirrors ProductLineItemsGrid's own `data-row`/`data-col` pattern. Enter on the last row's Credit cell adds a new (auto-balanced) line and focuses its Debit cell. */
  const handleKeyDown = (event: React.KeyboardEvent, rowIndex: number, colIndex: 0 | 1) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const targetRow = event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1;
      if (targetRow < 0 || targetRow >= lines.length) return;
      const target = containerRef.current?.querySelector<HTMLElement>(
        `[data-row="${targetRow}"][data-col="${colIndex}"]`,
      );
      if (target) {
        event.preventDefault();
        target.focus();
      }
      return;
    }
    if (event.key === "Enter" && colIndex === 1 && rowIndex === lines.length - 1) {
      event.preventDefault();
      addLine();
      requestAnimationFrame(() => {
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-row="${lines.length}"][data-col="0"]`)
          ?.focus();
      });
    }
  };

  const accountPicker = (line: JournalEntryLineGridRow) => (
    <AccountPicker
      postingOnly
      value={resolveAccount(line)}
      onChange={(account) => {
        if (account) {
          setPickedAccounts((current) =>
            current[account.id] ? current : { ...current, [account.id]: account },
          );
        }
        updateLine(line.id, {
          accountId: account?.id ?? "",
          account: account ? { id: account.id, code: account.code, name: account.name } : null,
        });
      }}
      placeholder={t("accounting.journalEntries.lines.selectAccount")}
      disabled={disabled}
      aria-label={t("accounting.journalEntries.lines.account")}
    />
  );

  const descriptionInput = (line: JournalEntryLineGridRow) => (
    <Input
      inputSize="compact-md"
      value={line.description}
      disabled={disabled}
      aria-label={t("accounting.journalEntries.lines.description")}
      onChange={(event) => updateLine(line.id, { description: event.target.value })}
    />
  );

  const partnerPicker = (line: JournalEntryLineGridRow) => (
    <EntityCombobox<LinePartner>
      value={line.partner}
      onChange={(partner) =>
        updateLine(line.id, {
          partnerId: partner?.id ?? "",
          partner: partner ?? null,
        })
      }
      onSearch={async (search) => {
        // Same `partners:` key space as PartnerPicker, so a quick-create
        // (`invalidateLookups("partners:")`) refreshes these rows too.
        const params = { search: search || undefined, pageSize: 8 };
        const result = await cachedLookup(`partners:any:${JSON.stringify(params)}`, () =>
          partnersService.catalog(params),
        );
        return result.items;
      }}
      getId={(partner) => partner.id}
      getTitle={(partner) => partner.name}
      subtitleDir="ltr"
      placeholder={t("partners.picker.selectPartner")}
      searchPlaceholder={t("partners.picker.placeholder")}
      emptyText={t("partners.picker.noResults")}
      disabled={disabled}
      allowClear
      triggerProps={{ "aria-label": t("partners.fields.name") }}
    />
  );

  const costCenterPicker = (line: JournalEntryLineGridRow) => (
    <CostCenterPicker
      items={costCenters ?? []}
      value={(costCenters ?? []).find((costCenter) => costCenter.id === line.costCenterId) ?? null}
      onChange={(costCenter) => updateLine(line.id, { costCenterId: costCenter?.id ?? "" })}
      disabled={disabled}
      aria-label={t("accounting.journalEntries.lines.costCenter")}
    />
  );

  const projectPicker = (line: JournalEntryLineGridRow) => (
    <ProjectPicker
      items={projects ?? []}
      value={(projects ?? []).find((project) => project.id === line.projectId) ?? null}
      onChange={(project) => updateLine(line.id, { projectId: project?.id ?? "" })}
      disabled={disabled}
      aria-label={t("accounting.journalEntries.lines.project")}
    />
  );

  const amountInput = (line: JournalEntryLineGridRow, rowIndex: number, side: 0 | 1) => (
    <MoneyInput
      data-row={rowIndex}
      data-col={side}
      aria-label={t(
        side === 0
          ? "accounting.journalEntries.lines.debit"
          : "accounting.journalEntries.lines.credit",
      )}
      value={(side === 0 ? line.debit : line.credit) || ""}
      disabled={disabled}
      onKeyDown={(event) => handleKeyDown(event, rowIndex, side)}
      onChange={(event) =>
        updateLine(
          line.id,
          side === 0
            ? { debit: event.target.valueAsNumber || 0, credit: 0 }
            : { credit: event.target.valueAsNumber || 0, debit: 0 },
        )
      }
    />
  );

  const removeButton = (line: JournalEntryLineGridRow) => (
    <IconActionButton
      label={t("common.remove")}
      disabled={disabled}
      onClick={() => removeLine(line.id)}
    >
      <Trash2 className="size-3.5" />
    </IconActionButton>
  );

  const addFooter = (
    <DocumentLineTableAddFooter
      onClick={addLine}
      disabled={disabled}
      label={t("accounting.journalEntries.lines.addLine")}
    />
  );

  // One totals block (design-system §8): debit, credit, then the difference
  // — flagged in words, never by color alone, when it is not zero.
  const totals =
    lines.length > 0 ? (
      <DocumentTotalsBlock
        label={t("docUi.totals.title")}
        currency={currency}
        lines={[
          { key: "debit", label: t("docUi.totals.totalDebit"), value: balance.totalDebit },
          { key: "credit", label: t("docUi.totals.totalCredit"), value: balance.totalCredit },
        ]}
        total={{
          key: "difference",
          label: t("docUi.totals.difference"),
          value: Math.abs(difference),
          flag: balance.isBalanced ? (
            <StatusBadge label={t("docUi.totals.balanced")} tone="success" />
          ) : (
            <StatusBadge label={t("docUi.totals.unbalanced")} tone="destructive" />
          ),
        }}
      />
    ) : null;

  const empty = (
    <p className="px-3 py-6 text-center text-caption text-muted-foreground">
      {t("accounting.journalEntries.lines.empty")}
    </p>
  );

  if (layout === "cards") {
    return (
      <div ref={containerRef} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-2">
          {lines.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border">{empty}</div>
          ) : (
            lines.map((line, rowIndex) => (
              <div
                key={line.id}
                data-testid="journal-line"
                className="flex flex-col gap-2 rounded-sm border border-border bg-card p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-caption text-muted-foreground">
                    {t("docUi.lines.lineNumber", { number: rowIndex + 1 })}
                  </span>
                  {removeButton(line)}
                </div>
                <CardField label={t("accounting.journalEntries.lines.account")}>
                  {accountPicker(line)}
                </CardField>
                <div className="grid grid-cols-2 gap-2">
                  <CardField label={t("accounting.journalEntries.lines.debit")}>
                    {amountInput(line, rowIndex, 0)}
                  </CardField>
                  <CardField label={t("accounting.journalEntries.lines.credit")}>
                    {amountInput(line, rowIndex, 1)}
                  </CardField>
                </div>
                <CardField label={t("accounting.journalEntries.lines.description")}>
                  {descriptionInput(line)}
                </CardField>
                <CardField label={t("partners.fields.name")}>{partnerPicker(line)}</CardField>
                {showCostAttribution ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <CardField label={t("accounting.journalEntries.lines.costCenter")}>
                      {costCenterPicker(line)}
                    </CardField>
                    <CardField label={t("accounting.journalEntries.lines.project")}>
                      {projectPicker(line)}
                    </CardField>
                  </div>
                ) : null}
              </div>
            ))
          )}
          <div className="overflow-hidden rounded-sm border border-border">{addFooter}</div>
        </div>
        {totals}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-w-0 flex-col gap-3">
      <DocumentLineTable minWidthClass="min-w-0" footer={addFooter}>
        <colgroup>
          {/* Account and description share the leftover width. */}
          <col />
          <col />
          <col className={PARTNER_WIDTH} />
          {inlineAttribution ? (
            <>
              <col className={ATTRIBUTION_WIDTH} />
              <col className={ATTRIBUTION_WIDTH} />
            </>
          ) : null}
          <col className={AMOUNT_WIDTH} />
          <col className={AMOUNT_WIDTH} />
          {disclosedAttribution ? <col className="w-(--width-control-actions)" /> : null}
          <col className="w-(--width-control-actions)" />
        </colgroup>
        <DocumentLineTableHeader>
          <DocumentLineTableRow className="hover:bg-transparent">
            <DocumentLineTableHead className={documentLineHeadClass}>
              {t("accounting.journalEntries.lines.account")}
            </DocumentLineTableHead>
            <DocumentLineTableHead className={documentLineHeadClass}>
              {t("accounting.journalEntries.lines.description")}
            </DocumentLineTableHead>
            <DocumentLineTableHead className={documentLineHeadClass}>
              {t("partners.fields.name")}
            </DocumentLineTableHead>
            {inlineAttribution ? (
              <>
                <DocumentLineTableHead className={documentLineHeadClass}>
                  {t("accounting.journalEntries.lines.costCenter")}
                </DocumentLineTableHead>
                <DocumentLineTableHead className={documentLineHeadClass}>
                  {t("accounting.journalEntries.lines.project")}
                </DocumentLineTableHead>
              </>
            ) : null}
            <DocumentLineTableHead className={documentLineNumericHeadClass}>
              {t("accounting.journalEntries.lines.debit")}
            </DocumentLineTableHead>
            <DocumentLineTableHead className={documentLineNumericHeadClass}>
              {t("accounting.journalEntries.lines.credit")}
            </DocumentLineTableHead>
            {disclosedAttribution ? (
              <DocumentLineTableHead className={documentLineHeadClass} />
            ) : null}
            <DocumentLineTableHead className={documentLineHeadClass} />
          </DocumentLineTableRow>
        </DocumentLineTableHeader>
        <DocumentLineTableBody>
          {lines.length === 0 ? (
            <DocumentLineTableRow className="hover:bg-transparent">
              <DocumentLineTableCell colSpan={columnCount} className="p-0">
                {empty}
              </DocumentLineTableCell>
            </DocumentLineTableRow>
          ) : (
            lines.map((line, rowIndex) => {
              const expanded = disclosedAttribution && expandedLines.has(line.id);
              const hasAttribution = Boolean(line.costCenterId || line.projectId);
              return (
                <Fragment key={line.id}>
                  <DocumentLineTableRow data-testid="journal-line">
                    <DocumentLineTableCell className={cn(documentLineCellClass, "min-w-0")}>
                      {accountPicker(line)}
                    </DocumentLineTableCell>
                    <DocumentLineTableCell className={documentLineCellClass}>
                      {descriptionInput(line)}
                    </DocumentLineTableCell>
                    <DocumentLineTableCell className={cn(documentLineCellClass, "min-w-0")}>
                      {partnerPicker(line)}
                    </DocumentLineTableCell>
                    {inlineAttribution ? (
                      <>
                        <DocumentLineTableCell className={cn(documentLineCellClass, "min-w-0")}>
                          {costCenterPicker(line)}
                        </DocumentLineTableCell>
                        <DocumentLineTableCell className={cn(documentLineCellClass, "min-w-0")}>
                          {projectPicker(line)}
                        </DocumentLineTableCell>
                      </>
                    ) : null}
                    <DocumentLineTableCell className={documentLineNumericCellClass}>
                      {amountInput(line, rowIndex, 0)}
                    </DocumentLineTableCell>
                    <DocumentLineTableCell className={documentLineNumericCellClass}>
                      {amountInput(line, rowIndex, 1)}
                    </DocumentLineTableCell>
                    {disclosedAttribution ? (
                      <DocumentLineTableCell className={documentLineCellClass}>
                        <IconActionButton
                          label={t(
                            expanded ? "docUi.lines.hideDetails" : "docUi.lines.showDetails",
                          )}
                          pressed={expanded}
                          aria-expanded={expanded}
                          className={cn(hasAttribution && !expanded && "text-primary")}
                          onClick={() => toggleExpanded(line.id)}
                        >
                          <ChevronDown
                            className={cn("size-3.5", expanded && "rotate-180")}
                            aria-hidden
                          />
                        </IconActionButton>
                      </DocumentLineTableCell>
                    ) : null}
                    <DocumentLineTableCell className={documentLineCellClass}>
                      {removeButton(line)}
                    </DocumentLineTableCell>
                  </DocumentLineTableRow>
                  {expanded ? (
                    <DocumentLineTableRow className="hover:bg-transparent">
                      <DocumentLineTableCell
                        colSpan={columnCount}
                        className={documentLineCellClass}
                      >
                        <div className="grid max-w-(--width-picker-customer) grid-cols-2 gap-2">
                          <CardField label={t("accounting.journalEntries.lines.costCenter")}>
                            {costCenterPicker(line)}
                          </CardField>
                          <CardField label={t("accounting.journalEntries.lines.project")}>
                            {projectPicker(line)}
                          </CardField>
                        </div>
                      </DocumentLineTableCell>
                    </DocumentLineTableRow>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </DocumentLineTableBody>
      </DocumentLineTable>
      {totals}
    </div>
  );
}

function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
