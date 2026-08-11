"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Check, ListChecks, X } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
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
  type ImportJobRow,
  type ImportJobRowRecord,
} from "@/services/import-jobs-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const IMPORT_TYPE = "STORE_ORDERS";

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
  const [rows, setRows] = useState<ImportJobRowRecord[]>([]);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [rejectTarget, setRejectTarget] = useState<ImportJobRowRecord | null>(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);

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
      setRows(await importJobsService.rows(selectedJobId, "NEEDS_REVIEW"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load rows.");
    } finally {
      setIsLoadingRows(false);
    }
  }, [selectedJobId]);

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
    if (!rejectTarget) return;
    try {
      await importJobsService.rejectRow(rejectTarget.jobId, rejectTarget.id);
      toast.success(t("storeOrders.needsReview.toasts.rejected"));
      void loadRows();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to reject row.");
    } finally {
      setRejectTarget(null);
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
    setBulkRejectOpen(false);
    if (!selectedJobId || selectedIds.length === 0) return;
    const result = await importJobsService.bulkRejectRows(selectedJobId, selectedIds);
    if (result.failed.length === 0) {
      toast.success(
        t("storeOrders.needsReview.toasts.bulkRejected", { count: result.succeeded.length }),
      );
    } else {
      toast.error(t("storeOrders.needsReview.toasts.bulkFailed", { count: result.failed.length }));
    }
    setRowSelection({});
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
      },
      {
        id: "__actions",
        header: t("common.actions"),
        meta: { titleKey: "common.actions" },
        enableSorting: false,
        cell: (info) => (
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
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/store-orders">{t("storeOrders.title")}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("nav.storeOrdersNeedsReview")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={t("nav.storeOrdersNeedsReview")}
        subtitle={t("storeOrders.needsReview.description")}
        filters={
          jobs.length > 0 ? (
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
          ) : undefined
        }
      />

      {jobs.length === 0 ? (
        <EmptyState icon={ListChecks} title={t("storeOrders.needsReview.noJobs")} />
      ) : (
        <EnterpriseDataTable
          tableId="store-orders-needs-review"
          printTitle={t("nav.storeOrdersNeedsReview")}
          columns={columns}
          data={rows}
          isLoading={isLoadingRows}
          getRowId={(row) => row.id}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          bulkActions={
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
          }
          onRefresh={loadRows}
          emptyTitle={t("storeOrders.needsReview.empty")}
        />
      )}

      <ConfirmationDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        tone="destructive"
        title={t("storeOrders.needsReview.confirmRejectTitle")}
        description={t("storeOrders.needsReview.confirmRejectDescription")}
        confirmLabel={t("storeOrders.needsReview.reject")}
        cancelLabel={t("common.close")}
        onConfirm={handleRejectConfirmed}
      />

      <ConfirmationDialog
        open={bulkRejectOpen}
        onOpenChange={setBulkRejectOpen}
        tone="destructive"
        title={t("storeOrders.needsReview.confirmBulkRejectTitle", { count: selectedIds.length })}
        description={t("storeOrders.needsReview.confirmRejectDescription")}
        confirmLabel={t("storeOrders.needsReview.reject")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkRejectConfirmed}
      />
    </div>
  );
}

export default function NeedsReviewPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <NeedsReviewContent />
    </PermissionGate>
  );
}
