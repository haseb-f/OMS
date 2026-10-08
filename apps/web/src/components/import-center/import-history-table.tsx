"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Eye } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { RowActionsMenu } from "@/components/shared/data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { reportApiError, toast } from "@/lib/toast";
import { IMPORT_JOB_STATUS_LABEL_KEY, IMPORT_JOB_STATUS_TONE } from "@/config/import-center/status";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import {
  isImportJobCancellable,
  type ImportJobRow,
  type ImportJobsApi,
} from "@/services/import-jobs-service";

/**
 * R15 — "My imports": the caller's import jobs (the server returns only the
 * caller's own; an `import-center.manage` holder sees every company job) with
 * created / skipped / failed counts. One table for the Store Orders import
 * page, the Leads import history and the agent portal imports page.
 */
export function ImportHistoryTable({
  tableId,
  printTitle,
  jobs,
  isLoading,
  onRefresh,
  onOpen,
  cancelWith,
  typeLabelKeys,
}: {
  tableId: string;
  printTitle: string;
  jobs: ImportJobRow[];
  isLoading: boolean;
  onRefresh: () => void;
  onOpen: (job: ImportJobRow) => void;
  /** The endpoint family that cancels an unfinished job; omit when the caller cannot import. */
  cancelWith?: ImportJobsApi;
  /** Shows a Type column (several import types in one list). */
  typeLabelKeys?: Record<string, string>;
}) {
  const { t } = useLocale();
  const [cancelTarget, setCancelTarget] = useState<ImportJobRow | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const columns = useMemo<ColumnDef<ImportJobRow, unknown>[]>(
    () => [
      {
        id: "status",
        header: t("importCenter.table.status"),
        meta: { titleKey: "importCenter.table.status", type: "status" },
        cell: (info) => {
          const status = info.row.original.status;
          return (
            <StatusBadge
              label={t(IMPORT_JOB_STATUS_LABEL_KEY[status])}
              tone={IMPORT_JOB_STATUS_TONE[status]}
            />
          );
        },
      },
      ...(typeLabelKeys
        ? [
            {
              id: "type",
              header: t("salesImport.history.type"),
              meta: { titleKey: "salesImport.history.type", type: "name" },
              accessorFn: (row: ImportJobRow) =>
                typeLabelKeys[row.importType]
                  ? t(typeLabelKeys[row.importType] as MessageKey)
                  : row.importType,
            } satisfies ColumnDef<ImportJobRow, unknown>,
          ]
        : []),
      {
        id: "fileName",
        header: t("importCenter.table.fileName"),
        meta: { titleKey: "importCenter.table.fileName", type: "name" },
        accessorFn: (row) => row.fileName || "—",
      },
      {
        id: "totalRows",
        header: t("importCenter.table.totalRows"),
        meta: { titleKey: "importCenter.table.totalRows", type: "number" },
        accessorFn: (row) => row.totalRows,
      },
      {
        id: "successCount",
        header: t("importCenter.table.successCount"),
        meta: { titleKey: "importCenter.table.successCount", type: "number" },
        accessorFn: (row) => row.successCount,
      },
      {
        id: "skippedCount",
        header: t("salesImport.history.skipped"),
        meta: { titleKey: "salesImport.history.skipped", type: "number" },
        accessorFn: (row) => row.skippedCount ?? 0,
      },
      {
        id: "errorCount",
        header: t("importCenter.table.errorCount"),
        meta: { titleKey: "importCenter.table.errorCount", type: "number" },
        accessorFn: (row) => row.errorCount,
      },
      {
        id: "createdAt",
        header: t("importCenter.table.createdAt"),
        meta: { titleKey: "importCenter.table.createdAt", type: "date" },
        accessorFn: (row) => formatDateTime(row.createdAt),
        cell: (info) => <span className="num">{info.getValue() as string}</span>,
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableSorting: false,
        enableHiding: false,
        cell: (info) => (
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "view",
                label: t("importCenter.viewJob"),
                icon: Eye,
                onSelect: () => onOpen(info.row.original),
              },
              {
                key: "cancel",
                label: t("importCenter.cancelJob"),
                icon: Ban,
                hidden: !cancelWith || !isImportJobCancellable(info.row.original.status),
                destructive: true,
                separatorBefore: true,
                onSelect: () => setCancelTarget(info.row.original),
              },
            ]}
          />
        ),
      },
    ],
    [t, onOpen, cancelWith, typeLabelKeys],
  );

  return (
    <>
      <EnterpriseDataTable
        tableId={tableId}
        printTitle={printTitle}
        columns={columns}
        data={jobs}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        emptyTitle={t("salesImport.history.empty")}
        onRefresh={onRefresh}
      />
      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        tone="destructive"
        title={t("importCenter.confirmCancelJobTitle")}
        description={t("importCenter.confirmCancelJobDescription")}
        confirmLabel={t("importCenter.cancelJob")}
        cancelLabel={t("common.cancel")}
        isConfirming={isCancelling}
        onConfirm={async () => {
          if (!cancelTarget || !cancelWith) return;
          setIsCancelling(true);
          try {
            await cancelWith.cancel(cancelTarget.id);
            toast.success(t("importCenter.cancelJob"));
            setCancelTarget(null);
            onRefresh();
          } catch (error) {
            reportApiError(error, "common.failedToSave");
          } finally {
            setIsCancelling(false);
          }
        }}
      />
    </>
  );
}
