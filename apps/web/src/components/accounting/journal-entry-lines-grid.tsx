"use client";

import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/shared/money-input";
import { AccountPicker } from "@/components/business/account-picker";
import { CostCenterPicker } from "@/components/business/cost-center-picker";
import { ProjectPicker } from "@/components/business/project-picker";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { ChartOfAccountRow, CostCenterRow, ProjectRow } from "@/config/master-data/entities";

let nextLineId = 1;

export interface JournalEntryLineGridRow {
  /** Client-side row identity — never the DB line id at this layer (mirrors AllocationGridLine.id). */
  id: string;
  accountId: string;
  description: string;
  /** TASK-053 — per-line cost attribution, distinct from the (still-unused) header-level JournalEntry.costCenterId/projectId. */
  costCenterId: string;
  projectId: string;
  debit: number;
  credit: number;
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
}: {
  lines: JournalEntryLineGridRow[];
  accounts: ChartOfAccountRow[];
  /** Omit to hide the Cost Center/Project columns entirely (e.g. the Opening Balance Wizard, which has no per-line cost attribution). */
  costCenters?: CostCenterRow[];
  projects?: ProjectRow[];
  onChange: (lines: JournalEntryLineGridRow[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const showCostAttribution = costCenters !== undefined && projects !== undefined;
  const columnCount = showCostAttribution ? 7 : 5;
  const containerRef = useRef<HTMLDivElement>(null);

  const updateLine = (id: string, patch: Partial<JournalEntryLineGridRow>) => {
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const removeLine = (id: string) => {
    onChange(lines.filter((line) => line.id !== id));
  };

  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = Math.abs(difference) < 0.001;

  /** "Auto balancing while typing" (Odoo-style) — a new line pre-fills whichever side clears the current outstanding difference, so a balanced entry is usually just "add line, pick account, Enter." */
  const addLine = () => {
    const newLine: JournalEntryLineGridRow = {
      id: `row-${nextLineId++}`,
      accountId: "",
      description: "",
      costCenterId: "",
      projectId: "",
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

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <Table className="w-full table-fixed border-separate border-spacing-0">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("accounting.journalEntries.lines.account")}</TableHead>
              <TableHead>{t("accounting.journalEntries.lines.description")}</TableHead>
              {showCostAttribution && (
                <>
                  <TableHead>{t("accounting.journalEntries.lines.costCenter")}</TableHead>
                  <TableHead>{t("accounting.journalEntries.lines.project")}</TableHead>
                </>
              )}
              <TableHead className="w-(--width-control-price) text-center">
                {t("accounting.journalEntries.lines.debit")}
              </TableHead>
              <TableHead className="w-(--width-control-price) text-center">
                {t("accounting.journalEntries.lines.credit")}
              </TableHead>
              <TableHead className="w-(--width-control-actions)" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="py-6 text-center text-caption text-muted-foreground"
                >
                  {t("accounting.journalEntries.lines.empty")}
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line, rowIndex) => (
                <TableRow key={line.id}>
                  <TableCell className="align-middle">
                    <AccountPicker
                      items={accounts}
                      value={accounts.find((account) => account.id === line.accountId) ?? null}
                      onChange={(account) => updateLine(line.id, { accountId: account?.id ?? "" })}
                      placeholder={t("accounting.journalEntries.lines.selectAccount")}
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell className="align-middle">
                    <Input
                      inputSize="compact-md"
                      value={line.description}
                      disabled={disabled}
                      onChange={(event) => updateLine(line.id, { description: event.target.value })}
                    />
                  </TableCell>
                  {showCostAttribution && (
                    <>
                      <TableCell className="align-middle">
                        <CostCenterPicker
                          items={costCenters ?? []}
                          value={
                            (costCenters ?? []).find(
                              (costCenter) => costCenter.id === line.costCenterId,
                            ) ?? null
                          }
                          onChange={(costCenter) =>
                            updateLine(line.id, { costCenterId: costCenter?.id ?? "" })
                          }
                          disabled={disabled}
                        />
                      </TableCell>
                      <TableCell className="align-middle">
                        <ProjectPicker
                          items={projects ?? []}
                          value={
                            (projects ?? []).find((project) => project.id === line.projectId) ??
                            null
                          }
                          onChange={(project) =>
                            updateLine(line.id, { projectId: project?.id ?? "" })
                          }
                          disabled={disabled}
                        />
                      </TableCell>
                    </>
                  )}
                  <TableCell className="w-(--width-control-price) align-middle">
                    <MoneyInput
                      data-row={rowIndex}
                      data-col={0}
                      align="center"
                      value={line.debit || ""}
                      disabled={disabled}
                      onKeyDown={(event) => handleKeyDown(event, rowIndex, 0)}
                      onChange={(event) =>
                        updateLine(line.id, { debit: event.target.valueAsNumber || 0, credit: 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="w-(--width-control-price) align-middle">
                    <MoneyInput
                      data-row={rowIndex}
                      data-col={1}
                      align="center"
                      value={line.credit || ""}
                      disabled={disabled}
                      onKeyDown={(event) => handleKeyDown(event, rowIndex, 1)}
                      onChange={(event) =>
                        updateLine(line.id, { credit: event.target.valueAsNumber || 0, debit: 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="w-(--width-control-actions) align-middle">
                    <EnterpriseButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      aria-label={t("common.remove")}
                      onClick={() => removeLine(line.id)}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </EnterpriseButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={disabled}
          onClick={addLine}
        >
          <Plus className="size-3.5" />
          {t("accounting.journalEntries.lines.addLine")}
        </EnterpriseButton>

        <div className="flex items-center gap-4 text-body">
          <span className="text-muted-foreground">
            {t("accounting.journalEntries.lines.totalDebit")}:{" "}
            <span dir="ltr">{formatMoney(totalDebit)}</span>
          </span>
          <span className="text-muted-foreground">
            {t("accounting.journalEntries.lines.totalCredit")}:{" "}
            <span dir="ltr">{formatMoney(totalCredit)}</span>
          </span>
          {lines.length > 0 && (
            <span className={cn("font-medium", isBalanced ? "text-success" : "text-destructive")}>
              {isBalanced
                ? t("accounting.journalEntries.lines.balanced")
                : `${t("accounting.journalEntries.lines.unbalanced")} (${formatMoney(Math.abs(difference))})`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
