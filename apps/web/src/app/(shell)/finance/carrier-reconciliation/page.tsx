"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Banknote, CheckCircle2, FileDown, Link2, Unlink, UploadCloud } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import {
  RowActionsMenu,
  useBulkLimitGuard,
  useSelectedRecords,
} from "@/components/shared/data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { BULK_LIMITS } from "@/lib/bulk-limits";
import { reportBulkResult, runBulkSequential } from "@/lib/bulk-run";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { CarrierChargeMatchDialog } from "@/components/shared/carrier-charge-match-dialog";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import {
  carrierReconciliationService,
  type CarrierChargeRow,
  type CarrierReconciliationStateValue,
} from "@/services/carrier-reconciliation-service";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import { downloadBlob } from "@/lib/download";
import {
  CHARGE_KIND_TONE,
  COST_STAGE_TONE,
  canMarkCarrierChargePaid,
  carrierChargeCsvTemplate,
  carrierCostStage,
  signedChargeAmount,
} from "@/lib/carrier-charge-status";
import { toast, reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

/** Bulk "Confirm matches": a matched charge with a shipment, not yet confirmed (same rule as the row action; the server re-checks each). */
function canBulkConfirm(row: CarrierChargeRow) {
  return (
    Boolean(row.shipmentId) &&
    (row.reconciliationState === "MATCHED" || row.reconciliationState === "REVIEW_REQUIRED")
  );
}

/** Bulk "Unmatch" rejects proposed matches only — a CONFIRMED charge is unmatched one at a time from its row. */
function canBulkUnmatch(row: CarrierChargeRow) {
  return row.reconciliationState === "MATCHED" || row.reconciliationState === "REVIEW_REQUIRED";
}

type BulkKind = "confirm" | "unmatch";

/** Filter order (same as the previous dropdown). */
const CARRIER_RECONCILIATION_STATES: CarrierReconciliationStateValue[] = [
  "UNMATCHED",
  "REVIEW_REQUIRED",
  "MATCHED",
  "CONFIRMED",
];

const STATE_TONE: Record<
  CarrierReconciliationStateValue,
  "success" | "warning" | "info" | "neutral"
> = {
  UNMATCHED: "neutral",
  MATCHED: "info",
  REVIEW_REQUIRED: "warning",
  CONFIRMED: "success",
};

function CarrierReconciliationContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canImport = hasPermission("carrier-reconciliation.import");
  const canMatch = hasPermission("carrier-reconciliation.match");
  const canConfirm = hasPermission("carrier-reconciliation.confirm");

  const [items, setItems] = useState<CarrierChargeRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<CarrierReconciliationStateValue | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [matchTarget, setMatchTarget] = useState<CarrierChargeRow | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CarrierChargeRow | null>(null);
  const [unmatchTarget, setUnmatchTarget] = useState<CarrierChargeRow | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isUnmatching, setIsUnmatching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [paidTarget, setPaidTarget] = useState<CarrierChargeRow | null>(null);
  const [paidReference, setPaidReference] = useState("");
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulk, setBulk] = useState<{
    kind: BulkKind;
    targets: CarrierChargeRow[];
    skipped: number;
  } | null>(null);
  const [isResolvingBulk, setIsResolvingBulk] = useState(false);
  const [isRunningBulk, setIsRunningBulk] = useState(false);
  const withinBulkLimit = useBulkLimitGuard();

  const listFilters = useMemo(
    () => ({
      state: stateFilter === "ALL" ? undefined : stateFilter,
      search: search || undefined,
    }),
    [stateFilter, search],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await carrierReconciliationService.list({ ...listFilters, page, pageSize });
      setItems(result.items);
      setTotalCount(result.total);
    } catch (error) {
      reportApiError(error, "common.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [listFilters, page, pageSize]);

  // Print: every row matching the current filters, not just the loaded page.
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        carrierReconciliationService.list({
          ...listFilters,
          page: nextPage,
          pageSize: nextPageSize,
        }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const selection = useSelectedRecords({ items, rowSelection, fetchAllRows, query: listFilters });

  /** Resolves the whole selection (every page), keeps the eligible records and opens the confirmation with exact counts. */
  const startBulk = async (kind: BulkKind) => {
    if (!withinBulkLimit(selection.selectedIds.length, BULK_LIMITS.carrierChargeBulkMax)) return;
    setIsResolvingBulk(true);
    try {
      // Always re-read: eligibility must reflect current states, not a cached page.
      const records = await selection.resolve({ fresh: true });
      if (!records) return;
      const eligible = records.filter(kind === "confirm" ? canBulkConfirm : canBulkUnmatch);
      if (eligible.length === 0) {
        toast.info(t(`carrierReconciliation.bulk.noneEligible.${kind}`));
        return;
      }
      setBulk({ kind, targets: eligible, skipped: records.length - eligible.length });
    } finally {
      setIsResolvingBulk(false);
    }
  };

  const runBulk = async () => {
    if (!bulk) return;
    setIsRunningBulk(true);
    const result = await runBulkSequential(bulk.targets, (row) =>
      bulk.kind === "confirm"
        ? carrierReconciliationService.confirm(row.id, row.shipmentId ?? undefined)
        : carrierReconciliationService.unmatch(row.id, { proposedOnly: true }),
    );
    setIsRunningBulk(false);
    reportBulkResult(result, {
      success: (count) => t(`carrierReconciliation.bulk.done.${bulk.kind}`, { count }),
      label: (row) => row.trackingNumber || row.carrierReference || row.shipmentReference || row.id,
    });
    setBulk(null);
    setRowSelection({});
    void load();
  };

  const columns = useMemo<ColumnDef<CarrierChargeRow, unknown>[]>(
    () => [
      {
        id: "carrier",
        header: t("carrierReconciliation.fields.carrier"),
        // The carrier is the card title (the agent column below would otherwise be inferred as the name).
        meta: { titleKey: "carrierReconciliation.fields.carrier" as MessageKey, type: "name" },
        accessorFn: (row) => row.shippingCompany?.name ?? row.carrierNameRaw,
      },
      {
        id: "reference",
        header: t("carrierReconciliation.fields.reference"),
        meta: {
          titleKey: "carrierReconciliation.fields.reference" as MessageKey,
          type: "reference",
        },
        cell: (info) => {
          const row = info.row.original;
          return (
            <span dir="ltr">
              {row.trackingNumber || row.carrierReference || row.shipmentReference || "—"}
            </span>
          );
        },
      },
      {
        id: "order",
        header: t("carrierReconciliation.fields.order"),
        meta: { titleKey: "carrierReconciliation.fields.order" as MessageKey, type: "default" },
        cell: (info) => {
          const shipment = info.row.original.shipment;
          if (!shipment) return "—";
          return (
            <SemanticValue kind="id">
              {shipment.storeOrder?.internalOrderId ?? "—"} · #{shipment.attemptNumber}
            </SemanticValue>
          );
        },
      },
      {
        id: "agent",
        header: t("carrierReconciliation.columns.agent"),
        meta: { titleKey: "carrierReconciliation.columns.agent" as MessageKey, type: "default" },
        accessorFn: (row) => {
          const agent = row.shipment?.storeOrder?.agent;
          return agent ? `${agent.name} (${agent.agentNumber})` : "—";
        },
      },
      {
        id: "kind",
        header: t("carrierReconciliation.columns.kind"),
        meta: { titleKey: "carrierReconciliation.columns.kind" as MessageKey, type: "status" },
        cell: (info) => {
          const kind = info.row.original.chargeKind ?? "BASE";
          return (
            <StatusBadge
              label={t(`carrierReconciliation.kinds.${kind}` as MessageKey)}
              tone={CHARGE_KIND_TONE[kind]}
            />
          );
        },
      },
      {
        id: "amount",
        header: t("carrierReconciliation.fields.amount"),
        meta: {
          titleKey: "carrierReconciliation.fields.amount" as MessageKey,
          align: "end",
          type: "money",
        },
        // A carrier credit reduces the shipping cost — shown as a negative amount.
        cell: (info) => (
          <MoneyValue
            value={signedChargeAmount(info.row.original)}
            currency={info.row.original.currency}
          />
        ),
      },
      {
        id: "chargeDate",
        header: t("carrierReconciliation.fields.chargeDate"),
        meta: { titleKey: "carrierReconciliation.fields.chargeDate" as MessageKey, type: "date" },
        accessorFn: (row) => formatDate(row.chargeDate),
      },
      {
        id: "state",
        header: t("common.status"),
        meta: { titleKey: "common.status" as MessageKey, type: "status" },
        cell: (info) => {
          const state = info.row.original.reconciliationState;
          return (
            <StatusBadge
              label={t(`carrierReconciliation.state.${state}` as MessageKey)}
              tone={STATE_TONE[state]}
            />
          );
        },
      },
      {
        id: "stage",
        header: t("carrierReconciliation.columns.stage"),
        meta: { titleKey: "carrierReconciliation.columns.stage" as MessageKey, type: "status" },
        cell: (info) => {
          const row = info.row.original;
          const stage = carrierCostStage(row);
          if (!stage) return "—";
          const badge = (
            <StatusBadge
              label={t(`carrierReconciliation.stage.${stage}` as MessageKey)}
              tone={COST_STAGE_TONE[stage]}
            />
          );
          if (stage !== "PAID") return badge;
          return (
            <StackedCell
              primary={badge}
              secondary={[
                t("carrierReconciliation.paid.paidOn", { date: formatDate(row.paidAt) }),
                row.paidReference,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          );
        },
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" as MessageKey },
        enableSorting: false,
        enableHiding: false,
        cell: (info) => {
          const row = info.row.original;
          return (
            <RowActionsMenu
              label={t("common.actions")}
              actions={[
                {
                  key: "match",
                  label: t("carrierReconciliation.actions.match"),
                  icon: Link2,
                  hidden: !canMatch || row.reconciliationState === "CONFIRMED",
                  onSelect: () => setMatchTarget(row),
                },
                {
                  key: "confirm",
                  label: t("carrierReconciliation.actions.confirm"),
                  icon: CheckCircle2,
                  hidden:
                    !canConfirm ||
                    !row.shipmentId ||
                    row.reconciliationState === "CONFIRMED" ||
                    row.reconciliationState === "UNMATCHED",
                  onSelect: () => setConfirmTarget(row),
                },
                {
                  key: "markPaid",
                  label: t("carrierReconciliation.paid.action"),
                  icon: Banknote,
                  hidden: !canConfirm || !canMarkCarrierChargePaid(row),
                  onSelect: () => {
                    setPaidReference("");
                    setPaidTarget(row);
                  },
                },
                {
                  key: "unmatch",
                  label: t("carrierReconciliation.actions.unmatch"),
                  icon: Unlink,
                  hidden: !canMatch || row.reconciliationState === "UNMATCHED",
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => setUnmatchTarget(row),
                },
              ]}
            />
          );
        },
      },
    ],
    [t, canMatch, canConfirm],
  );

  const openImportPicker = () => {
    if (isImporting) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setIsImporting(true);
      carrierReconciliationService
        .import(file)
        .then((summary) => {
          toast.success(
            t("carrierReconciliation.import.summary", {
              matched: String(summary.matchedRows),
              review: String(summary.reviewRows),
              unmatched: String(summary.unmatchedRows),
              duplicate: String(summary.duplicateRows),
            }),
          );
          if (summary.errorRows.length > 0) {
            toast.error(
              t("carrierReconciliation.import.errors", {
                count: String(summary.errorRows.length),
              }),
            );
          }
          void load();
        })
        .catch((error: unknown) => {
          reportApiError(error, "common.failedToSave");
        })
        .finally(() => setIsImporting(false));
    };
    input.click();
  };

  return (
    <PageWorkspace
      dense
      title={t("carrierReconciliation.title")}
      description={t("carrierReconciliation.description")}
      actions={
        <HeaderActions
          secondary={[
            {
              key: "import",
              label: t("carrierReconciliation.import.action"),
              icon: UploadCloud,
              disabled: !canImport,
              loading: isImporting,
              onSelect: openImportPicker,
            },
          ]}
          more={[
            {
              key: "csvTemplate",
              label: t("carrierReconciliation.csv.template"),
              icon: FileDown,
              onSelect: () =>
                downloadBlob(
                  new Blob([carrierChargeCsvTemplate()], { type: "text/csv;charset=utf-8" }),
                  "carrier-charges-template.csv",
                ),
            },
          ]}
        />
      }
    >
      <p className="text-caption text-muted-foreground">{t("carrierReconciliation.csv.help")}</p>
      <EnterpriseDataTable
        tableId="carrier-reconciliation"
        printTitle={t("carrierReconciliation.title")}
        columns={columns}
        data={items}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        fetchAllRows={fetchAllRows}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("carrierReconciliation.searchPlaceholder")}
        filterBar={
          <SelectFilter
            label={t("common.status")}
            // "ALL" is the API's no-filter sentinel; SelectFilter's "" is its all-state.
            value={stateFilter === "ALL" ? "" : stateFilter}
            onChange={(value) => {
              setStateFilter((value || "ALL") as CarrierReconciliationStateValue | "ALL");
              setPage(1);
            }}
            allLabel={t("carrierReconciliation.state.ALL")}
            options={CARRIER_RECONCILIATION_STATES.map((state) => ({
              value: state,
              label: t(`carrierReconciliation.state.${state}`),
            }))}
          />
        }
        isLoading={isLoading}
        getRowId={(row) => row.id}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        selectionResetKey={listFilters}
        bulkActions={
          canConfirm || canMatch ? (
            <>
              {canConfirm ? (
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={isResolvingBulk}
                  onClick={() => void startBulk("confirm")}
                >
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  {t("carrierReconciliation.bulk.action.confirm")}
                </EnterpriseButton>
              ) : null}
              {canMatch ? (
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={isResolvingBulk}
                  onClick={() => void startBulk("unmatch")}
                >
                  <Unlink className="size-3.5" aria-hidden />
                  {t("carrierReconciliation.bulk.action.unmatch")}
                </EnterpriseButton>
              ) : null}
            </>
          ) : undefined
        }
        emptyTitle={t("carrierReconciliation.empty")}
        onRefresh={load}
      />

      <CarrierChargeMatchDialog
        charge={matchTarget}
        open={matchTarget != null}
        onOpenChange={(open) => {
          if (!open) setMatchTarget(null);
        }}
        onMatched={() => void load()}
      />

      <ConfirmationDialog
        open={confirmTarget != null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={t("carrierReconciliation.confirmDialog.title")}
        description={t("carrierReconciliation.confirmDialog.description")}
        confirmLabel={t("carrierReconciliation.actions.confirm")}
        isConfirming={isConfirming}
        onConfirm={() => {
          if (!confirmTarget) return;
          setIsConfirming(true);
          carrierReconciliationService
            .confirm(confirmTarget.id)
            .then(() => {
              toast.success(t("carrierReconciliation.confirmDialog.saved"));
              setConfirmTarget(null);
              void load();
            })
            .catch((error: unknown) => {
              reportApiError(error, "common.failedToSave");
            })
            .finally(() => setIsConfirming(false));
        }}
      />

      <ConfirmationDialog
        open={unmatchTarget != null}
        onOpenChange={(open) => {
          if (!open) setUnmatchTarget(null);
        }}
        tone="warning"
        title={t("carrierReconciliation.unmatchDialog.title")}
        description={t("carrierReconciliation.unmatchDialog.description")}
        confirmLabel={t("carrierReconciliation.actions.unmatch")}
        isConfirming={isUnmatching}
        onConfirm={() => {
          if (!unmatchTarget) return;
          setIsUnmatching(true);
          carrierReconciliationService
            .unmatch(unmatchTarget.id)
            .then(() => {
              toast.success(t("carrierReconciliation.unmatchDialog.saved"));
              setUnmatchTarget(null);
              void load();
            })
            .catch((error: unknown) => {
              reportApiError(error, "common.failedToSave");
            })
            .finally(() => setIsUnmatching(false));
        }}
      />

      <ConfirmationDialog
        open={paidTarget != null}
        onOpenChange={(open) => {
          if (!open) setPaidTarget(null);
        }}
        title={t("carrierReconciliation.paid.dialogTitle")}
        description={t("carrierReconciliation.paid.dialogDescription")}
        extra={
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="carrier-charge-paid-reference">
              {t("carrierReconciliation.paid.reference")}
            </Label>
            <Input
              id="carrier-charge-paid-reference"
              dir="auto"
              maxLength={200}
              value={paidReference}
              onChange={(event) => setPaidReference(event.target.value)}
              autoFocus
            />
          </div>
        }
        confirmLabel={t("carrierReconciliation.paid.action")}
        confirmDisabled={!paidReference.trim()}
        isConfirming={isMarkingPaid}
        onConfirm={() => {
          if (!paidTarget || !paidReference.trim()) return;
          setIsMarkingPaid(true);
          carrierReconciliationService
            .markPaid(paidTarget.id, paidReference.trim())
            .then(() => {
              toast.success(t("carrierReconciliation.paid.saved"));
              setPaidTarget(null);
              void load();
            })
            .catch((error: unknown) => {
              reportApiError(error, "common.failedToSave");
            })
            .finally(() => setIsMarkingPaid(false));
        }}
      />

      <ConfirmationDialog
        open={bulk != null}
        onOpenChange={(open) => {
          if (!open && !isRunningBulk) setBulk(null);
        }}
        tone={bulk?.kind === "unmatch" ? "warning" : undefined}
        title={
          bulk
            ? t(`carrierReconciliation.bulk.title.${bulk.kind}`, { count: bulk.targets.length })
            : ""
        }
        description={
          bulk ? (
            <>
              {t(`carrierReconciliation.bulk.description.${bulk.kind}`)}
              {bulk.skipped > 0 ? (
                <> {t("carrierReconciliation.bulk.skipped", { count: bulk.skipped })}</>
              ) : null}
            </>
          ) : null
        }
        confirmLabel={bulk ? t(`carrierReconciliation.bulk.action.${bulk.kind}`) : undefined}
        isConfirming={isRunningBulk}
        onConfirm={() => void runBulk()}
      />
    </PageWorkspace>
  );
}

export default function CarrierReconciliationPage() {
  return (
    <PermissionGate permission="carrier-reconciliation.view">
      <CarrierReconciliationContent />
    </PermissionGate>
  );
}
