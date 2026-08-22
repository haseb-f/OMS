"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Check, RotateCcw, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { RowActionsMenu } from "@/components/shared/data-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { humanizeSyncIssue } from "./messages";
import { SyncRowDetails } from "./sync-row-details";
import { SyncRowStatusBadge } from "./sync-status-badge";
import {
  defaultDecision,
  isImportable,
  type SyncReviewDecision,
  type SyncReviewRow,
} from "./types";

function identityPrimary(row: SyncReviewRow): string {
  return row.values.externalOrderId?.trim() || row.values.internalOrderId?.trim() || "";
}

function identitySecondary(row: SyncReviewRow): string {
  return (
    row.values.trackingNumber?.trim() ||
    row.values.productSku?.trim() ||
    row.values.status?.trim() ||
    ""
  );
}

function SyncReviewMobileCard({
  row,
  selected,
  onToggleSelected,
  expanded,
  onToggleExpanded,
  decision,
  onAccept,
  onReject,
}: {
  row: SyncReviewRow;
  selected: boolean;
  onToggleSelected: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  decision: SyncReviewDecision;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { t } = useLocale();
  const issue = row.issues[0];
  const issueText =
    row.issues.length > 1
      ? t("importCenter.sync.review.errorsInRow", { count: row.issues.length })
      : issue
        ? humanizeSyncIssue(issue, t)
        : null;

  return (
    <div className={cn("border-b border-border last:border-b-0", selected && "bg-primary/5")}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected()}
          aria-label={t("table.selectRow")}
          className="mt-1.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <StackedCell
              primary={<SemanticValue kind="number">{row.rowNumber}</SemanticValue>}
              secondary={
                identityPrimary(row) ? (
                  <SemanticValue kind="id">{identityPrimary(row)}</SemanticValue>
                ) : undefined
              }
            />
            <SyncRowStatusBadge row={row} />
          </div>
          {row.values.customerName || row.normalizedPhone || row.originalPhone ? (
            <div className="mt-1">
              <StackedCell
                primary={row.values.customerName}
                secondary={
                  row.normalizedPhone || row.originalPhone ? (
                    <SemanticValue kind="phone">
                      {row.normalizedPhone ?? row.originalPhone}
                    </SemanticValue>
                  ) : undefined
                }
              />
            </div>
          ) : null}
          {issueText ? (
            <p className="mt-1 text-caption text-muted-foreground">{issueText}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <EnterpriseButton type="button" variant="ghost" size="xs" onClick={onToggleExpanded}>
              {expanded ? t("common.collapse") : t("importCenter.sync.review.actionView")}
            </EnterpriseButton>
            {isImportable(row.status, row.lifecycle) && decision !== "ACCEPT" ? (
              <EnterpriseButton type="button" variant="outline" size="xs" onClick={onAccept}>
                {row.lifecycle === "PHONE_MATCH"
                  ? t("importCenter.sync.review.actionAcceptAsNewOrder")
                  : row.status === "WARNING"
                    ? t("importCenter.sync.review.actionAcceptWarning")
                    : t("importCenter.sync.review.actionAccept")}
              </EnterpriseButton>
            ) : null}
            {decision !== "REJECT" ? (
              <EnterpriseButton type="button" variant="destructive" size="xs" onClick={onReject}>
                {row.status === "DUPLICATE"
                  ? t("importCenter.sync.review.actionSkip")
                  : t("importCenter.sync.review.actionReject")}
              </EnterpriseButton>
            ) : null}
          </div>
          {expanded ? (
            <div className="mt-2 border-t border-border pt-2">
              <SyncRowDetails row={row} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SyncReviewTable({
  rows,
  decisions,
  rowSelection,
  onRowSelectionChange,
  onDecision,
  onRetry,
  bulkActions,
}: {
  rows: SyncReviewRow[];
  decisions: Record<string, SyncReviewDecision>;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (next: RowSelectionState) => void;
  onDecision: (rowIds: string[], decision: SyncReviewDecision) => void;
  onRetry?: (rowNumbers: number[]) => void;
  bulkActions?: ReactNode;
}) {
  const { t } = useLocale();

  const columns = useMemo<ColumnDef<SyncReviewRow, unknown>[]>(
    () => [
      {
        id: "rowNumber",
        meta: {
          titleKey: "importCenter.sync.review.colRow",
          type: "code",
          importance: "critical",
          minWidth: 72,
          maxWidth: 96,
        },
        accessorFn: (row) => row.rowNumber,
        cell: ({ row }) => <SemanticValue kind="number">{row.original.rowNumber}</SemanticValue>,
      },
      {
        id: "identity",
        meta: {
          titleKey: "importCenter.sync.review.colOrder",
          stacked: true,
          type: "code",
          importance: "critical",
          minWidth: 140,
          grow: 1.2,
        },
        accessorFn: (row) => `${identityPrimary(row)} ${identitySecondary(row)}`,
        cell: ({ row }) => (
          <StackedCell
            primary={
              identityPrimary(row.original) ? (
                <SemanticValue kind="id">{identityPrimary(row.original)}</SemanticValue>
              ) : null
            }
            secondary={
              identitySecondary(row.original) ? (
                <SemanticValue kind="id">{identitySecondary(row.original)}</SemanticValue>
              ) : undefined
            }
          />
        ),
      },
      {
        id: "party",
        meta: {
          titleKey: "importCenter.sync.review.colCustomer",
          stacked: true,
          type: "name",
          importance: "high",
          minWidth: 160,
          grow: 1.4,
        },
        accessorFn: (row) => row.values.customerName ?? "",
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.values.customerName}
            secondary={
              row.original.normalizedPhone || row.original.originalPhone ? (
                <SemanticValue kind="phone">
                  {row.original.normalizedPhone ?? row.original.originalPhone}
                </SemanticValue>
              ) : undefined
            }
          />
        ),
      },
      {
        id: "product",
        meta: {
          titleKey: "importCenter.sync.review.colProduct",
          importance: "medium",
          minWidth: 120,
        },
        accessorFn: (row) => row.values.productSku ?? "",
        cell: ({ row }) => row.original.values.productSku || null,
      },
      {
        id: "country",
        meta: {
          titleKey: "importCenter.sync.review.country",
          importance: "medium",
          minWidth: 110,
        },
        accessorFn: (row) => row.countryName ?? row.values.countryName ?? "",
        cell: ({ row }) => row.original.countryName ?? row.original.values.countryName ?? null,
      },
      {
        id: "phone",
        meta: {
          titleKey: "importCenter.sync.review.colPhone",
          stacked: true,
          importance: "medium",
          minWidth: 140,
          defaultHidden: true,
        },
        accessorFn: (row) => row.originalPhone ?? "",
        cell: ({ row }) => (
          <StackedCell
            primary={
              row.original.originalPhone ? (
                <SemanticValue kind="phone">{row.original.originalPhone}</SemanticValue>
              ) : null
            }
            secondary={
              row.original.normalizedPhone ? (
                <SemanticValue kind="phone">{row.original.normalizedPhone}</SemanticValue>
              ) : row.original.originalPhone ? (
                "—"
              ) : undefined
            }
          />
        ),
      },
      {
        id: "status",
        meta: {
          titleKey: "importCenter.sync.review.colStatus",
          type: "status",
          importance: "critical",
          minWidth: 108,
        },
        accessorFn: (row) => row.status,
        cell: ({ row }) => <SyncRowStatusBadge row={row.original} />,
      },
      {
        id: "issue",
        meta: {
          titleKey: "importCenter.sync.review.colIssue",
          stacked: true,
          importance: "high",
          minWidth: 180,
          grow: 1.6,
        },
        accessorFn: (row) => row.issues.map((issue) => issue.message).join(" "),
        cell: ({ row }) => {
          const issues = row.original.issues;
          if (issues.length === 0) return null;
          const unique = [...new Set(issues.map((issue) => humanizeSyncIssue(issue, t)))];
          return <StackedCell primary={unique.join("؛ ")} />;
        },
      },
      {
        id: "actions",
        meta: {
          titleKey: "common.actions",
          type: "actions",
          importance: "critical",
        },
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          const decision = decisions[item.id] ?? defaultDecision(item);
          return (
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  key: "accept",
                  label:
                    item.lifecycle === "PHONE_MATCH"
                      ? t("importCenter.sync.review.actionAcceptAsNewOrder")
                      : item.status === "WARNING"
                        ? t("importCenter.sync.review.actionAcceptWarning")
                        : t("importCenter.sync.review.actionAccept"),
                  icon: Check,
                  hidden: !isImportable(item.status, item.lifecycle) || decision === "ACCEPT",
                  onSelect: () => onDecision([item.id], "ACCEPT"),
                },
                {
                  key: "retry",
                  label: t("importCenter.sync.review.actionRetry"),
                  icon: RotateCcw,
                  hidden: !onRetry || !item.retryable,
                  onSelect: () => onRetry?.(item.rowNumbers),
                },
                {
                  key: "reject",
                  label:
                    item.status === "DUPLICATE"
                      ? t("importCenter.sync.review.actionSkip")
                      : t("importCenter.sync.review.actionReject"),
                  icon: X,
                  hidden: decision === "REJECT",
                  destructive: item.status !== "DUPLICATE",
                  onSelect: () => onDecision([item.id], "REJECT"),
                },
              ]}
            />
          );
        },
      },
    ],
    [decisions, onDecision, onRetry, t],
  );

  return (
    <EnterpriseDataTable
      tableId="sync-review"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      rowSelection={rowSelection}
      onRowSelectionChange={onRowSelectionChange}
      bulkActions={bulkActions}
      emptyTitle={t("importCenter.sync.review.empty")}
      getRowCanExpand={() => true}
      renderExpandedRegions={(row) => [
        {
          startColumnId: "rowNumber",
          grow: "until-next-region",
          content: <SyncRowDetails row={row} />,
        },
      ]}
      renderMobileRow={({ row, selected, onToggleSelected, expanded, onToggleExpanded }) => (
        <SyncReviewMobileCard
          row={row}
          selected={selected}
          onToggleSelected={onToggleSelected}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          decision={decisions[row.id] ?? defaultDecision(row)}
          onAccept={() => onDecision([row.id], "ACCEPT")}
          onReject={() => onDecision([row.id], "REJECT")}
        />
      )}
    />
  );
}
