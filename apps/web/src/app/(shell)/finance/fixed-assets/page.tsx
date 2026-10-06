"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  fixedAssetsColumns,
  fixedAssetsFormFields,
  fixedAssetsSchema,
  fixedAssetsDefaultValues,
  fixedAssetsExportColumns,
  fixedAssetRowLabel,
  type CostCenterRow,
} from "@/config/master-data/entities";
import { fixedAssetsService } from "@/services/fixed-assets-service";
import { useSuppliers } from "@/hooks/use-reference-data";
import { useProcessDueSchedules } from "@/hooks/use-process-due-schedules";
import { cachedLookup } from "@/lib/lookup-cache";
import {
  receivingAccountsService,
  type ReceivingAccountOption as SharedReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");

/** `/receiving-accounts` rows carry `code` at runtime; the shared option type does not declare it. */
type ReceivingAccountOption = SharedReceivingAccountOption & { code?: string };

/**
 * Fixed-asset register. A row opens the asset's detail screen
 * (`[id]/page.tsx`) — parameters, source invoice, depreciation schedule and
 * the lifecycle actions (Capitalize with schedule preview, Dispose, Link
 * invoice line). "Process due entries" runs the same posting as the daily job.
 */
function FixedAssetsPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  // Session-cached supplier-role partners (same list Products uses).
  const suppliers = useSuppliers();
  const [tableKey, setTableKey] = useState(0);
  const [runOpen, setRunOpen] = useState(false);
  const processDue = useProcessDueSchedules("all", () => setTableKey((value) => value + 1));

  useEffect(() => {
    cachedLookup("cost-centers:prefetch:500", () => costCentersService.list({ pageSize: 500 }))
      .then((result) => setCostCenters(result.items))
      .catch(() => setCostCenters([]));
    receivingAccountsService
      .list()
      .then((rows) => setReceivingAccounts(rows as ReceivingAccountOption[]))
      .catch(() => setReceivingAccounts([]));
  }, []);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...fixedAssetsFormFields.flatMap((field): MasterDataFormField[] =>
        field.name === "usefulLifeMonths"
          ? [
              field,
              {
                name: "depreciationMethod",
                label: "assetSchedules.fields.method",
                type: "select",
                options: (["STRAIGHT_LINE", "DECLINING_BALANCE"] as const).map((method) => ({
                  value: method,
                  label: t(`assetSchedules.methods.${method}`),
                })),
              },
            ]
          : [field],
      ),
      {
        name: "costCenterId",
        label: "masterData.expenses.fields.costCenter",
        type: "select",
        options: costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
      },
      {
        name: "receivingAccountId",
        label: "masterData.fixedAssets.fields.receivingAccount",
        type: "select",
        options: receivingAccounts.map((account) => ({
          value: account.id,
          label: account.code ? `${account.code} — ${account.name}` : account.name,
        })),
      },
      {
        name: "partnerId",
        label: "masterData.fixedAssets.fields.partner",
        type: "select",
        options: suppliers.map((partner) => ({
          value: partner.id,
          label: partner.partnerNumber
            ? `${partner.partnerNumber} — ${partner.name}`
            : partner.name,
        })),
      },
    ],
    [costCenters, receivingAccounts, suppliers, t],
  );

  return (
    <>
      <MasterDataPage
        key={tableKey}
        titleKey="masterData.fixedAssets.title"
        descriptionKey="masterData.fixedAssets.description"
        tableId="fixed-assets"
        service={fixedAssetsService}
        columns={fixedAssetsColumns}
        exportColumnKeys={fixedAssetsExportColumns}
        formFields={formFields}
        schema={fixedAssetsSchema}
        defaultValues={fixedAssetsDefaultValues}
        permissionPrefix="masterdata.fixed-assets"
        rowLabel={fixedAssetRowLabel}
        defaultSortBy="acquisitionDate"
        getRowHref={(row) => `/finance/fixed-assets/${row.id}`}
        headerSecondary={[
          {
            key: "process-due",
            label: t("assetSchedules.actions.processDue"),
            hidden: !hasPermission("masterdata.fixed-assets.edit"),
            onSelect: () => setRunOpen(true),
          },
        ]}
        toFormValues={(entity) => ({
          name: entity.name,
          code: entity.code ?? "",
          acquisitionDate: entity.acquisitionDate,
          cost: Number(entity.cost),
          usefulLifeMonths: entity.usefulLifeMonths ?? 0,
          depreciationMethod: entity.depreciationMethod ?? "STRAIGHT_LINE",
          salvageValue: Number(entity.salvageValue ?? 0),
          depreciationStartDate: entity.depreciationStartDate ?? "",
          costCenterId: entity.costCenterId ?? "",
          receivingAccountId: entity.receivingAccountId ?? "",
          partnerId: entity.partnerId ?? "",
          notes: entity.notes ?? "",
        })}
      />

      <ConfirmationDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        title={t("assetSchedules.actions.processDue")}
        description={t("assetSchedules.dialogs.processDueDescription")}
        confirmLabel={t("assetSchedules.actions.processDue")}
        isConfirming={processDue.busy}
        onConfirm={() => void processDue.run().then(() => setRunOpen(false))}
      />
    </>
  );
}

export default function FixedAssetsPage() {
  return (
    <PermissionGate permission="masterdata.fixed-assets.view">
      <FixedAssetsPageContent />
    </PermissionGate>
  );
}
