"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Link2, Unlink, UploadCloud } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { RowActionsMenu } from "@/components/shared/data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { CarrierChargeMatchDialog } from "@/components/shared/carrier-charge-match-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  carrierReconciliationService,
  type CarrierChargeRow,
  type CarrierReconciliationStateValue,
} from "@/services/carrier-reconciliation-service";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

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
  const [isLoading, setIsLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<CarrierReconciliationStateValue | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [matchTarget, setMatchTarget] = useState<CarrierChargeRow | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CarrierChargeRow | null>(null);
  const [unmatchTarget, setUnmatchTarget] = useState<CarrierChargeRow | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isUnmatching, setIsUnmatching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await carrierReconciliationService.list({
        state: stateFilter === "ALL" ? undefined : stateFilter,
        search: search || undefined,
        pageSize: 50,
      });
      setItems(result.items);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [stateFilter, search, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<CarrierChargeRow, unknown>[]>(
    () => [
      {
        id: "carrier",
        header: t("carrierReconciliation.fields.carrier"),
        meta: { titleKey: "carrierReconciliation.fields.carrier" as MessageKey },
        accessorFn: (row) => row.shippingCompany?.name ?? row.carrierNameRaw,
      },
      {
        id: "reference",
        header: t("carrierReconciliation.fields.reference"),
        meta: { titleKey: "carrierReconciliation.fields.reference" as MessageKey },
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
        meta: { titleKey: "carrierReconciliation.fields.order" as MessageKey },
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
        id: "amount",
        header: t("carrierReconciliation.fields.amount"),
        meta: { titleKey: "carrierReconciliation.fields.amount" as MessageKey, align: "end" },
        cell: (info) => (
          <MoneyValue
            value={info.row.original.chargeAmount}
            currency={info.row.original.currency}
          />
        ),
      },
      {
        id: "chargeDate",
        header: t("carrierReconciliation.fields.chargeDate"),
        meta: { titleKey: "carrierReconciliation.fields.chargeDate" as MessageKey },
        accessorFn: (row) => formatDate(row.chargeDate),
      },
      {
        id: "state",
        header: t("common.status"),
        meta: { titleKey: "common.status" as MessageKey },
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

  return (
    <PageWorkspace
      dense
      title={t("carrierReconciliation.title")}
      description={t("carrierReconciliation.description")}
      actions={
        <EnterpriseButton
          type="button"
          disabled={!canImport || isImporting}
          onClick={() => {
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
                  toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
                })
                .finally(() => setIsImporting(false));
            };
            input.click();
          }}
        >
          <UploadCloud />
          {t("carrierReconciliation.import.action")}
        </EnterpriseButton>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={stateFilter}
          onValueChange={(value) =>
            setStateFilter(value as CarrierReconciliationStateValue | "ALL")
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("carrierReconciliation.state.ALL")}</SelectItem>
            <SelectItem value="UNMATCHED">{t("carrierReconciliation.state.UNMATCHED")}</SelectItem>
            <SelectItem value="REVIEW_REQUIRED">
              {t("carrierReconciliation.state.REVIEW_REQUIRED")}
            </SelectItem>
            <SelectItem value="MATCHED">{t("carrierReconciliation.state.MATCHED")}</SelectItem>
            <SelectItem value="CONFIRMED">{t("carrierReconciliation.state.CONFIRMED")}</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("carrierReconciliation.searchPlaceholder")}
          className="w-64"
        />
      </div>

      <EnterpriseDataTable
        tableId="carrier-reconciliation"
        printTitle={t("carrierReconciliation.title")}
        columns={columns}
        data={items}
        isLoading={isLoading}
        getRowId={(row) => row.id}
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
              toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
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
              toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
            })
            .finally(() => setIsUnmatching(false));
        }}
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
