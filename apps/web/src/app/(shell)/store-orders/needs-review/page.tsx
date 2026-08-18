"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Check, ListChecks, X } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  importJobsService,
  IMPORT_ROW_REJECTION_REASON_CODES,
  type ImportJobRow,
  type ImportJobRowRecord,
  type ImportRowRejectionReasonCode,
} from "@/services/import-jobs-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const IMPORT_TYPE = "STORE_ORDERS";

/**
 * Rejection always requires a reason (Part 1 of the four-gaps task) — this
 * small picker is shared by the individual-row and bulk reject dialogs so
 * the "must provide a reason before rejection completes" rule can never be
 * bypassed from either entry point.
 */
function RejectReasonPicker({
  code,
  note,
  onCodeChange,
  onNoteChange,
}: {
  code: ImportRowRejectionReasonCode | "";
  note: string;
  onCodeChange: (code: ImportRowRejectionReasonCode) => void;
  onNoteChange: (note: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-3 pt-2 text-start">
      <div className="flex flex-col gap-1.5">
        <Label>
          {t("storeOrders.needsReview.rejectReason.label")}{" "}
          <span className="text-destructive">*</span>
        </Label>
        <Select value={code} onValueChange={(v) => onCodeChange(v as ImportRowRejectionReasonCode)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("storeOrders.needsReview.rejectReason.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_ROW_REJECTION_REASON_CODES.map((reasonCode) => (
              <SelectItem key={reasonCode} value={reasonCode}>
                {t(`storeOrders.needsReview.rejectReason.codes.${reasonCode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {code === "OTHER" && (
        <div className="flex flex-col gap-1.5">
          <Label>
            {t("storeOrders.needsReview.rejectReason.noteLabel")}{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={2}
            placeholder={t("storeOrders.needsReview.rejectReason.notePlaceholder")}
          />
        </div>
      )}
    </div>
  );
}

function rawField(row: ImportJobRowRecord, key: string): string {
  const value = row.rawRowData[key];
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

/**
 * Needs Review (Store Orders import) — an existing-customer-by-phone match
 * requires an explicit human confirm/reject click, per row or in bulk;
 * confirming attaches the row's order to the matched Customer found by
 * phone, rejecting discards the row. Neither ever happens automatically.
 */
function NeedsReviewContent() {
  const { t } = useLocale();

  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [viewStatus, setViewStatus] = useState<"NEEDS_REVIEW" | "REJECTED">("NEEDS_REVIEW");
  const [rows, setRows] = useState<ImportJobRowRecord[]>([]);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [rejectTarget, setRejectTarget] = useState<ImportJobRowRecord | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<ImportRowRejectionReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");

  const resetReason = () => {
    setReasonCode("");
    setReasonNote("");
  };

  const reasonIsValid = reasonCode !== "" && (reasonCode !== "OTHER" || reasonNote.trim() !== "");

  useEffect(() => {
    importJobsService
      .list(IMPORT_TYPE)
      .then((list) => {
        setJobs(list);
        if (list.length > 0) setSelectedJobId((current) => current || list[0].id);
      })
      .catch(() => setJobs([]));
  }, []);

  const loadRows = useCallback(async () => {
    if (!selectedJobId) {
      setRows([]);
      return;
    }
    setIsLoadingRows(true);
    try {
      setRows(await importJobsService.rows(selectedJobId, viewStatus));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load rows.");
    } finally {
      setIsLoadingRows(false);
    }
  }, [selectedJobId, viewStatus]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
    setRowSelection({});
  }, [loadRows]);

  const handleConfirmRow = async (row: ImportJobRowRecord) => {
    try {
      await importJobsService.confirmRow(row.jobId, row.id);
      toast.success(t("storeOrders.needsReview.toasts.confirmed"));
      void loadRows();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to confirm row.");
    }
  };

  const handleRejectConfirmed = async () => {
    if (!rejectTarget || !reasonIsValid) return;
    try {
      await importJobsService.rejectRow(rejectTarget.jobId, rejectTarget.id, {
        reasonCode: reasonCode as ImportRowRejectionReasonCode,
        note: reasonCode === "OTHER" ? reasonNote.trim() : undefined,
      });
      toast.success(t("storeOrders.needsReview.toasts.rejected"));
      void loadRows();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to reject row.");
    } finally {
      setRejectTarget(null);
      resetReason();
    }
  };

  const selectedIds = Object.keys(rowSelection);

  const handleBulkConfirm = async () => {
    if (!selectedJobId || selectedIds.length === 0) return;
    const result = await importJobsService.bulkConfirmRows(selectedJobId, selectedIds);
    if (result.failed.length === 0) {
      toast.success(
        t("storeOrders.needsReview.toasts.bulkConfirmed", { count: result.succeeded.length }),
      );
    } else {
      toast.error(t("storeOrders.needsReview.toasts.bulkFailed", { count: result.failed.length }));
    }
    setRowSelection({});
    void loadRows();
  };

  const handleBulkRejectConfirmed = async () => {
    if (!selectedJobId || selectedIds.length === 0 || !reasonIsValid) return;
    setBulkRejectOpen(false);
    const result = await importJobsService.bulkRejectRows(selectedJobId, selectedIds, {
      reasonCode: reasonCode as ImportRowRejectionReasonCode,
      note: reasonCode === "OTHER" ? reasonNote.trim() : undefined,
    });
    if (result.failed.length === 0) {
      toast.success(
        t("storeOrders.needsReview.toasts.bulkRejected", { count: result.succeeded.length }),
      );
    } else {
      toast.error(t("storeOrders.needsReview.toasts.bulkFailed", { count: result.failed.length }));
    }
    setRowSelection({});
    resetReason();
    void loadRows();
  };

  const columns = useMemo<ColumnDef<ImportJobRowRecord, unknown>[]>(
    () => [
      {
        id: "rowNumber",
        header: t("importCenter.wizard.preview.rowNumber"),
        meta: { titleKey: "importCenter.wizard.preview.rowNumber" },
        accessorFn: (row) => row.rowNumber,
      },
      {
        id: "externalOrderId",
        header: t("importCenter.fields.externalOrderId"),
        meta: { titleKey: "importCenter.fields.externalOrderId" },
        accessorFn: (row) => rawField(row, "externalOrderId"),
        cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
      },
      {
        id: "customerName",
        header: t("importCenter.fields.customerName"),
        meta: { titleKey: "importCenter.fields.customerName" },
        accessorFn: (row) => rawField(row, "customerName"),
      },
      {
        id: "matchedCustomer",
        header: t("storeOrders.needsReview.matchedCustomer"),
        meta: { titleKey: "storeOrders.needsReview.matchedCustomer" },
        accessorFn: (row) => row.matchedCustomerName ?? "—",
        cell: (info) => (
          <div className="flex flex-col">
            <span className="font-medium">{info.getValue() as string}</span>
            {info.row.original.matchedCustomerPhone && (
              <span dir="ltr" className="text-caption text-muted-foreground">
                {info.row.original.matchedCustomerPhone}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "reviewReason",
        header: t("storeOrders.needsReview.reason"),
        meta: { titleKey: "storeOrders.needsReview.reason" },
        accessorFn: (row) => row.reviewReason ?? "—",
        cell: (info) =>
          viewStatus === "NEEDS_REVIEW" ? (
            (info.getValue() as string)
          ) : (
            <span className="text-caption text-muted-foreground">{info.getValue() as string}</span>
          ),
      },
      ...(viewStatus === "REJECTED"
        ? [
            {
              id: "rejectionReason",
              header: t("storeOrders.needsReview.rejectReason.label"),
              meta: { titleKey: "storeOrders.needsReview.rejectReason.label" },
              accessorFn: (row: ImportJobRowRecord) =>
                row.rejectionReasonCode
                  ? t(`storeOrders.needsReview.rejectReason.codes.${row.rejectionReasonCode}`)
                  : "—",
              cell: (info: { row: { original: ImportJobRowRecord } }) => (
                <div className="flex flex-col">
                  <span className="font-medium">
                    {info.row.original.rejectionReasonCode
                      ? t(
                          `storeOrders.needsReview.rejectReason.codes.${info.row.original.rejectionReasonCode}`,
                        )
                      : "—"}
                  </span>
                  {info.row.original.rejectionReasonNote && (
                    <span className="text-caption text-muted-foreground">
                      {info.row.original.rejectionReasonNote}
                    </span>
                  )}
                </div>
              ),
            } satisfies ColumnDef<ImportJobRowRecord, unknown>,
          ]
        : [
            {
              id: "__actions",
              header: t("common.actions"),
              meta: { titleKey: "common.actions" },
              enableSorting: false,
              cell: (info: { row: { original: ImportJobRowRecord } }) => (
                <div className="flex items-center gap-1.5">
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleConfirmRow(info.row.original)}
                  >
                    <Check className="size-3.5" />
                    {t("storeOrders.needsReview.confirm")}
                  </EnterpriseButton>
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive"
                    onClick={() => setRejectTarget(info.row.original)}
                  >
                    <X className="size-3.5" />
                    {t("storeOrders.needsReview.reject")}
                  </EnterpriseButton>
                </div>
              ),
            } satisfies ColumnDef<ImportJobRowRecord, unknown>,
          ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, viewStatus],
  );

  return (
    <PageWorkspace
      title={t("nav.storeOrdersNeedsReview")}
      description={t("storeOrders.needsReview.description")}
    >
      {jobs.length === 0 ? (
        <EmptyState icon={ListChecks} title={t("storeOrders.needsReview.noJobs")} />
      ) : (
        <EnterpriseDataTable
          filterBar={
            jobs.length > 0 ? (
              <>
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger size="sm" className="w-72">
                    <SelectValue placeholder={t("storeOrders.needsReview.selectJob")} />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        <span dir="ltr">{job.fileName || job.id}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={viewStatus}
                  onValueChange={(v) => setViewStatus(v as "NEEDS_REVIEW" | "REJECTED")}
                >
                  <SelectTrigger size="sm" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEEDS_REVIEW">
                      {t("storeOrders.needsReview.viewNeedsReview")}
                    </SelectItem>
                    <SelectItem value="REJECTED">
                      {t("storeOrders.needsReview.viewRejected")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : undefined
          }

          tableId="store-orders-needs-review"
          printTitle={t("nav.storeOrdersNeedsReview")}
          columns={columns}
          data={rows}
          isLoading={isLoadingRows}
          getRowId={(row) => row.id}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          bulkActions={
            viewStatus === "NEEDS_REVIEW" ? (
              <>
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleBulkConfirm}
                >
                  <Check className="size-3.5" />
                  {t("storeOrders.needsReview.bulkConfirm")}
                </EnterpriseButton>
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive"
                  onClick={() => setBulkRejectOpen(true)}
                >
                  <X className="size-3.5" />
                  {t("storeOrders.needsReview.bulkReject")}
                </EnterpriseButton>
              </>
            ) : undefined
          }
          onRefresh={loadRows}
          emptyTitle={t("storeOrders.needsReview.empty")}
        />
      )}

      <ConfirmationDialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            resetReason();
          }
        }}
        tone="destructive"
        title={t("storeOrders.needsReview.confirmRejectTitle")}
        description={t("storeOrders.needsReview.confirmRejectDescription")}
        extra={
          <RejectReasonPicker
            code={reasonCode}
            note={reasonNote}
            onCodeChange={setReasonCode}
            onNoteChange={setReasonNote}
          />
        }
        confirmLabel={t("storeOrders.needsReview.reject")}
        cancelLabel={t("common.close")}
        onConfirm={handleRejectConfirmed}
        confirmDisabled={!reasonIsValid}
      />

      <ConfirmationDialog
        open={bulkRejectOpen}
        onOpenChange={(open) => {
          setBulkRejectOpen(open);
          if (!open) resetReason();
        }}
        tone="destructive"
        title={t("storeOrders.needsReview.confirmBulkRejectTitle", { count: selectedIds.length })}
        description={t("storeOrders.needsReview.confirmRejectDescription")}
        extra={
          <RejectReasonPicker
            code={reasonCode}
            note={reasonNote}
            onCodeChange={setReasonCode}
            onNoteChange={setReasonNote}
          />
        }
        confirmLabel={t("storeOrders.needsReview.reject")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkRejectConfirmed}
        confirmDisabled={!reasonIsValid}
      />
    </PageWorkspace>
  );
}

export default function NeedsReviewPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <NeedsReviewContent />
    </PermissionGate>
  );
}
