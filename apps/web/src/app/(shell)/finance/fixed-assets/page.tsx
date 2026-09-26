"use client";

import { useEffect, useMemo, useState } from "react";
import { Landmark, ScrollText, Trash2 } from "lucide-react";
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
  type FixedAssetRow,
  type CostCenterRow,
} from "@/config/master-data/entities";
import { fixedAssetsService } from "@/services/fixed-assets-service";
import { useSuppliers } from "@/hooks/use-reference-data";
import { cachedLookup } from "@/lib/lookup-cache";
import {
  receivingAccountsService,
  type ReceivingAccountOption as SharedReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RowAction } from "@/components/shared/data-table";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { useRouter } from "next/navigation";
import { journalEntriesService } from "@/services/journal-entries-service";

const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");

/** `/receiving-accounts` rows carry `code` at runtime; the shared option type does not declare it. */
type ReceivingAccountOption = SharedReceivingAccountOption & { code?: string };

function FixedAssetsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  // Session-cached supplier-role partners (same list Products uses).
  const suppliers = useSuppliers();
  const [tableKey, setTableKey] = useState(0);
  const [capitalizeTarget, setCapitalizeTarget] = useState<FixedAssetRow | null>(null);
  const [disposeTarget, setDisposeTarget] = useState<FixedAssetRow | null>(null);
  const [disposeAmount, setDisposeAmount] = useState("0");
  const [runOpen, setRunOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => setTableKey((value) => value + 1);

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
      ...fixedAssetsFormFields,
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
    [costCenters, receivingAccounts, suppliers],
  );

  const handleCapitalize = async () => {
    if (!capitalizeTarget) return;
    if (!capitalizeTarget.usefulLifeMonths) {
      toast.error(t("masterData.fixedAssets.validation.usefulLifeRequired"));
      return;
    }
    if (!capitalizeTarget.receivingAccountId && !capitalizeTarget.partnerId) {
      toast.error(t("masterData.fixedAssets.validation.paymentSourceRequired"));
      return;
    }
    setBusy(true);
    try {
      await fixedAssetsService.capitalize(capitalizeTarget.id, {
        usefulLifeMonths: capitalizeTarget.usefulLifeMonths,
        salvageValue: Number(capitalizeTarget.salvageValue ?? 0),
        depreciationStartDate: capitalizeTarget.depreciationStartDate
          ? capitalizeTarget.depreciationStartDate.slice(0, 10)
          : undefined,
        receivingAccountId: capitalizeTarget.receivingAccountId ?? undefined,
        partnerId: capitalizeTarget.partnerId ?? undefined,
      });
      toast.success(t("masterData.fixedAssets.toasts.capitalized"));
      setCapitalizeTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const handleDispose = async () => {
    if (!disposeTarget) return;
    setBusy(true);
    try {
      await fixedAssetsService.dispose(disposeTarget.id, {
        disposalAmount: Number(disposeAmount || 0),
        receivingAccountId: disposeTarget.receivingAccountId ?? undefined,
      });
      toast.success(t("masterData.fixedAssets.toasts.disposed"));
      setDisposeTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const handleRun = async () => {
    setBusy(true);
    try {
      const result = await fixedAssetsService.runDepreciation({});
      toast.success(
        t("masterData.fixedAssets.toasts.depreciationRun", { count: result.postedCount }),
      );
      setRunOpen(false);
      reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

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
        extraActions={
          <EnterpriseButton
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setRunOpen(true)}
          >
            {t("masterData.fixedAssets.actions.runDepreciation")}
          </EnterpriseButton>
        }
        extraRowActions={(entity): RowAction[] => [
          {
            key: "capitalize",
            label: t("masterData.fixedAssets.actions.capitalize"),
            icon: Landmark,
            hidden: entity.status !== "DRAFT" || Boolean(entity.deletedAt),
            onSelect: () => setCapitalizeTarget(entity),
          },
          {
            key: "dispose",
            label: t("masterData.fixedAssets.actions.dispose"),
            icon: Trash2,
            hidden: entity.status !== "CAPITALIZED" || Boolean(entity.deletedAt),
            onSelect: () => {
              setDisposeAmount("0");
              setDisposeTarget(entity);
            },
          },
          {
            key: "journal",
            label: t("accounting.journalEntries.fields.viewJournalEntry"),
            icon: ScrollText,
            hidden: entity.status === "DRAFT" || Boolean(entity.deletedAt),
            onSelect: () => {
              const sourceType =
                entity.status === "DISPOSED"
                  ? "FIXED_ASSET_DISPOSAL"
                  : "FIXED_ASSET_CAPITALIZATION";
              void journalEntriesService
                .list({ sourceType, sourceId: entity.id, status: "POSTED", pageSize: 1 })
                .then((result) => {
                  const entry = result.items[0];
                  if (entry) router.push(`/finance/journal-entries/${entry.id}`);
                  else toast.error(t("accounting.journalEntries.missingJournal"));
                })
                .catch((error: unknown) => {
                  toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
                });
            },
          },
        ]}
        toFormValues={(entity) => ({
          name: entity.name,
          code: entity.code ?? "",
          acquisitionDate: entity.acquisitionDate,
          cost: Number(entity.cost),
          usefulLifeMonths: entity.usefulLifeMonths ?? 0,
          salvageValue: Number(entity.salvageValue ?? 0),
          depreciationStartDate: entity.depreciationStartDate ?? "",
          costCenterId: entity.costCenterId ?? "",
          receivingAccountId: entity.receivingAccountId ?? "",
          partnerId: entity.partnerId ?? "",
          notes: entity.notes ?? "",
        })}
      />

      <ConfirmationDialog
        open={Boolean(capitalizeTarget)}
        onOpenChange={(open) => {
          if (!open) setCapitalizeTarget(null);
        }}
        title={t("masterData.fixedAssets.actions.capitalize")}
        description={capitalizeTarget ? fixedAssetRowLabel(capitalizeTarget) : undefined}
        confirmLabel={t("masterData.fixedAssets.actions.capitalize")}
        isConfirming={busy}
        onConfirm={() => void handleCapitalize()}
      />

      <ConfirmationDialog
        open={Boolean(disposeTarget)}
        onOpenChange={(open) => {
          if (!open) setDisposeTarget(null);
        }}
        title={t("masterData.fixedAssets.actions.dispose")}
        description={disposeTarget ? fixedAssetRowLabel(disposeTarget) : undefined}
        extra={
          <div className="flex flex-col gap-1.5 px-6">
            <label className="text-caption text-muted-foreground">
              {t("masterData.fixedAssets.fields.disposalAmount")}
            </label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={disposeAmount}
              onChange={(event) => setDisposeAmount(event.target.value)}
            />
          </div>
        }
        tone="warning"
        confirmLabel={t("masterData.fixedAssets.actions.dispose")}
        isConfirming={busy}
        onConfirm={() => void handleDispose()}
      />

      <ConfirmationDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        title={t("masterData.fixedAssets.actions.runDepreciation")}
        confirmLabel={t("masterData.fixedAssets.actions.runDepreciation")}
        isConfirming={busy}
        onConfirm={() => void handleRun()}
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
