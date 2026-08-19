"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseBadge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  DEFAULT_SHIPPING_STATUS,
  SHIPMENT_STATUS_LABEL_KEY,
  SHIPMENT_STATUS_TONE,
  SHIPPING_STATUS_CATALOG,
} from "@/config/shipping/shipment-status";
import type { ShipmentStatusValue } from "@/services/shipping-service";
import { useLocale } from "@/providers/locale-provider";

interface ShippingStatusRow {
  id: ShipmentStatusValue;
  code: ShipmentStatusValue;
  isDefault: boolean;
  isSystem: boolean;
}

function ShippingStatusesPageContent() {
  const { t } = useLocale();
  const rows: ShippingStatusRow[] = SHIPPING_STATUS_CATALOG.map((status) => ({
    id: status.code,
    code: status.code,
    isDefault: status.isDefault,
    isSystem: status.isSystem,
  }));

  const columns = useMemo<ColumnDef<ShippingStatusRow, unknown>[]>(
    () => [
      {
        id: "code",
        meta: { titleKey: "masterData.fields.code" },
        accessorFn: (row) => row.code,
      },
      {
        id: "name",
        meta: { titleKey: "masterData.fields.name" },
        accessorFn: (row) => t(SHIPMENT_STATUS_LABEL_KEY[row.code]),
        cell: ({ row }) => (
          <StatusBadge
            label={t(SHIPMENT_STATUS_LABEL_KEY[row.original.code])}
            tone={SHIPMENT_STATUS_TONE[row.original.code]}
          />
        ),
      },
      {
        id: "role",
        meta: { titleKey: "masterData.shippingStatuses.role" },
        accessorFn: (row) =>
          row.isDefault
            ? t("masterData.shippingStatuses.default")
            : t("masterData.shippingStatuses.system"),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1.5">
            {row.original.isDefault ? (
              <EnterpriseBadge variant="default">
                {t("masterData.shippingStatuses.default")}
              </EnterpriseBadge>
            ) : null}
            {row.original.isSystem ? (
              <EnterpriseBadge variant="outline">
                {t("masterData.shippingStatuses.system")}
              </EnterpriseBadge>
            ) : null}
          </div>
        ),
      },
    ],
    [t],
  );

  return (
    <PageWorkspace
      title={t("masterData.shippingStatuses.title")}
      description={t("masterData.shippingStatuses.description")}
    >
      <EnterpriseDataTable
        tableId="shipping-statuses"
        columns={columns}
        data={rows}
        isLoading={false}
        emptyTitle={t("common.noResults")}
      />
      <p className="text-caption text-muted-foreground">
        {t("masterData.shippingStatuses.protectedHint", {
          status: t(SHIPMENT_STATUS_LABEL_KEY[DEFAULT_SHIPPING_STATUS]),
        })}
      </p>
    </PageWorkspace>
  );
}

export default function ShippingStatusesPage() {
  return (
    <PermissionGate permission="shipping.view">
      <ShippingStatusesPageContent />
    </PermissionGate>
  );
}
