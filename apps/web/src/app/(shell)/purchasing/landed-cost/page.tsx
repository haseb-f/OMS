"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { MultiSelectFilter, getColumnDisplayValue } from "@/components/shared/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import { landedCostService, type LandedCostDocumentRow } from "@/services/landed-cost-service";
import {
  LANDED_COST_FILTERABLE_STATUSES,
  LANDED_COST_STATUS_LABEL_KEY,
  LANDED_COST_STATUS_TONE,
} from "@/config/purchasing/landed-cost-status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";

function LandedCostPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();

  const [items, setItems] = useState<LandedCostDocumentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setItems(await landedCostService.list());
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to load Landed Cost documents.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("landed-cost.create");

  const filteredItems = useMemo(
    () =>
      statusFilter.length === 0
        ? items
        : items.filter((item) => statusFilter.includes(item.status)),
    [items, statusFilter],
  );

  const columns = useMemo<ColumnDef<LandedCostDocumentRow, unknown>[]>(
    () => [
      {
        id: "documentNumber",
        header: t("purchasing.landedCost.fields.number"),
        meta: { titleKey: "purchasing.landedCost.fields.number" },
        accessorFn: (row) => row.documentNumber,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "purchaseInvoice",
        header: t("purchasing.landedCost.fields.purchaseInvoice"),
        meta: { titleKey: "purchasing.landedCost.fields.purchaseInvoice" },
        accessorFn: (row) => row.purchaseInvoice?.invoiceNumber ?? row.purchaseInvoiceId,
      },
      {
        id: "provider",
        header: t("purchasing.landedCost.fields.provider"),
        meta: { titleKey: "purchasing.landedCost.fields.provider" },
        accessorFn: (row) => row.provider?.name ?? "—",
      },
      {
        id: "netTotal",
        header: t("purchasing.landedCost.fields.netTotal"),
        meta: { titleKey: "purchasing.landedCost.fields.netTotal" },
        accessorFn: (row) =>
          Number(row.netTotal).toLocaleString(undefined, { minimumFractionDigits: 2 }),
      },
      {
        id: "status",
        header: t("common.status"),
        meta: { titleKey: "common.status" },
        accessorFn: (row) => t(LANDED_COST_STATUS_LABEL_KEY[row.status]),
        cell: ({ row }) => (
          <StatusBadge
            label={t(LANDED_COST_STATUS_LABEL_KEY[row.original.status])}
            tone={LANDED_COST_STATUS_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "documentDate",
        header: t("purchasing.landedCost.fields.date"),
        meta: { titleKey: "purchasing.landedCost.fields.date" },
        accessorFn: (row) => formatDate(row.documentDate),
      },
    ],
    [t],
  );

  return (
    <PageWorkspace
      dense
      title={t("purchasing.landedCost.title")}
      description={t("purchasing.landedCost.description")}
      actions={
        canCreate && (
          <EnterpriseButton
            type="button"
            onClick={() => router.push("/purchasing/landed-cost/new")}
          >
            <Plus />
            {t("purchasing.landedCost.addNew")}
          </EnterpriseButton>
        )
      }
    >
      <EnterpriseDataTable
        filterBar={
          <MultiSelectFilter
            label={t("purchasing.landedCost.filters.status")}
            values={statusFilter}
            onChange={setStatusFilter}
            options={LANDED_COST_FILTERABLE_STATUSES.map((status) => ({
              value: status,
              label: t(LANDED_COST_STATUS_LABEL_KEY[status]),
            }))}
          />
        }
        tableId="purchasing-landed-cost"
        printTitle={t("purchasing.landedCost.title")}
        columns={columns}
        data={filteredItems}
        isLoading={isLoading}
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(
          columns,
          columns.map((c) => c.id!),
          t,
        )}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            filteredItems.map((item) =>
              Object.fromEntries(columns.map((c) => [c.id!, getColumnDisplayValue(c, item)])),
            ),
            keys,
            "landed-cost.csv",
            labels,
          )
        }
        emptyTitle={t("purchasing.landedCost.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/purchasing/landed-cost/${row.id}`}
      />
    </PageWorkspace>
  );
}

export default function LandedCostPage() {
  return (
    <PermissionGate permission="landed-cost.view">
      <LandedCostPageContent />
    </PermissionGate>
  );
}
