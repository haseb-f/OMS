"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Landmark, Link2, PlayCircle, Trash2, Unlink } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailSummaryBar,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { RelatedDocuments, type RelatedDocumentGroup } from "@/components/shared/related-documents";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyValue } from "@/components/shared/money-value";
import { MoneyInput } from "@/components/shared/money-input";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/business/status-badge";
import { PartnerPicker } from "@/components/business/partner-picker";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import type { PartnerPickerRow } from "@/services/partners-service";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  AccountingScheduleTable,
  SchedulePreviewTable,
} from "@/components/accounting/schedule-table";
import {
  fixedAssetsService,
  type FixedAssetDetail,
  type FixedAssetSchedulePreview,
  type LinkableInvoiceLine,
} from "@/services/fixed-assets-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { useProcessDueSchedules } from "@/hooks/use-process-due-schedules";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";
import { fixedAssetStatusTone } from "@/config/finance/schedule-status";

function toIsoDate(date: Date | null): string | null {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function lineLabel(line: LinkableInvoiceLine) {
  const product = line.product?.displayName || line.product?.name || "";
  const parts = [
    line.purchaseInvoice.invoiceNumber,
    line.purchaseInvoice.referenceNumber,
    line.purchaseInvoice.partner?.name,
    line.description?.trim() || product,
    formatMoney(line.netAmount, line.purchaseInvoice.currency?.code),
  ];
  return parts.filter(Boolean).join(" · ");
}

type Dialog = "capitalize" | "dispose" | "process" | "link" | null;

/** R13b (O-1) — where disposal proceeds go: cash into a receiving account, or a supplier credit (Dr AP). */
type Settlement = "CASH" | "SUPPLIER_CREDIT";

function FixedAssetDetailContent() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("masterdata.fixed-assets.edit");

  const [asset, setAsset] = useState<FixedAssetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FixedAssetSchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [disposalDate, setDisposalDate] = useState<Date | null>(new Date());
  const [disposalAmount, setDisposalAmount] = useState("");
  const [disposalNotes, setDisposalNotes] = useState("");
  const [disposalAccountId, setDisposalAccountId] = useState("");
  const [settlement, setSettlement] = useState<Settlement>("CASH");
  const [creditSupplier, setCreditSupplier] = useState<PartnerPickerRow | null>(null);
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  const [linkableLines, setLinkableLines] = useState<LinkableInvoiceLine[] | null>(null);
  const [lineId, setLineId] = useState("");

  useBreadcrumbLabel(asset?.code ?? asset?.name ?? null);

  const load = useCallback(async () => {
    try {
      setAsset(await fixedAssetsService.detail(params.id));
    } catch {
      setAsset(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const processDue = useProcessDueSchedules("all", load);

  const openCapitalize = async () => {
    if (!asset) return;
    setPreview(null);
    setPreviewError(null);
    setDialog("capitalize");
    try {
      setPreview(await fixedAssetsService.schedulePreview(asset.id));
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : t("assetSchedules.dialogs.capitalizeNeedsLife"),
      );
    }
  };

  const openDispose = () => {
    if (!asset) return;
    setDisposalDate(new Date());
    setDisposalAmount("");
    setDisposalNotes("");
    setDisposalAccountId(asset.receivingAccountId ?? "");
    setSettlement("CASH");
    setCreditSupplier(null);
    setDialog("dispose");
    receivingAccountsService
      .list()
      .then(setReceivingAccounts)
      .catch(() => setReceivingAccounts([]));
  };

  const openLink = () => {
    setLineId("");
    setLinkableLines(null);
    setDialog("link");
    fixedAssetsService
      .linkableInvoiceLines()
      .then(setLinkableLines)
      .catch((error: unknown) => {
        setLinkableLines([]);
        reportApiError(error, "errors.generic");
      });
  };

  const act = async (action: () => Promise<unknown>, successKey: MessageKey) => {
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey));
      setDialog(null);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setBusy(false);
    }
  };

  const relatedGroups = useMemo<RelatedDocumentGroup[]>(() => {
    if (!asset) return [];
    const groups: RelatedDocumentGroup[] = [];
    if (asset.purchaseInvoice) {
      groups.push({
        labelKey: "assetSchedules.links.sourceInvoice",
        links: [
          {
            id: asset.purchaseInvoice.id,
            number: asset.purchaseInvoice.invoiceNumber,
            href: `/purchasing/purchase-invoices/${asset.purchaseInvoice.id}`,
            kind: "PURCHASE_INVOICE",
            status: asset.purchaseInvoice.status,
          },
        ],
      });
    }
    if (asset.purchaseReturn) {
      groups.push({
        labelKey: "assetSchedules.links.purchaseReturn",
        links: [
          {
            id: asset.purchaseReturn.id,
            number: asset.purchaseReturn.returnNumber,
            href: `/purchasing/purchase-returns/${asset.purchaseReturn.id}`,
            kind: "PURCHASE_RETURN",
            status: asset.purchaseReturn.status,
          },
        ],
      });
    }
    if (asset.costAdditions.length > 0) {
      groups.push({
        labelKey: "assetSchedules.links.costAddedBy",
        links: asset.costAdditions.map((addition) => ({
          id: addition.purchaseInvoiceItem.purchaseInvoice.id,
          number: `${addition.purchaseInvoiceItem.purchaseInvoice.invoiceNumber} · ${formatMoney(Number(addition.amount))}`,
          href: `/purchasing/purchase-invoices/${addition.purchaseInvoiceItem.purchaseInvoice.id}`,
          kind: "PURCHASE_INVOICE",
        })),
      });
    }
    const { capitalization, disposal } = asset.journalEntries;
    groups.push({
      labelKey: "assetSchedules.links.capitalizationEntry",
      links: capitalization
        ? [
            {
              id: capitalization.id,
              number: capitalization.entryNumber,
              href: `/finance/journal-entries/${capitalization.id}`,
              kind: "JOURNAL_ENTRY",
            },
          ]
        : [],
      emptyLabel:
        asset.status !== "DRAFT" ? t("accounting.journalEntries.missingJournal") : undefined,
    });
    if (disposal) {
      groups.push({
        labelKey: "assetSchedules.links.disposalEntry",
        links: [
          {
            id: disposal.id,
            number: disposal.entryNumber,
            href: `/finance/journal-entries/${disposal.id}`,
            kind: "JOURNAL_ENTRY",
          },
        ],
      });
    }
    return groups;
  }, [asset, t]);

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!asset) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const isDraft = asset.status === "DRAFT";
  const isLinked = Boolean(asset.purchaseInvoiceItemId);
  const { summary } = asset;
  const sourceLine = asset.purchaseInvoiceItem;

  return (
    <DetailWorkspace
      title={asset.name}
      reference={asset.code}
      copyValue={asset.code}
      meta={[formatDate(asset.acquisitionDate), asset.partner?.name].filter(Boolean).join(" · ")}
      status={
        <StatusBadge
          label={t(`accounting.lifecycleStatus.${asset.status}` as MessageKey)}
          tone={fixedAssetStatusTone[asset.status]}
        />
      }
      width="wide"
      actions={
        <HeaderActions
          primary={
            isDraft && !isLinked
              ? {
                  key: "capitalize",
                  label: t("masterData.fixedAssets.actions.capitalize"),
                  icon: Landmark,
                  hidden: !canEdit,
                  onSelect: () => void openCapitalize(),
                }
              : asset.status === "CAPITALIZED"
                ? {
                    key: "process-due",
                    label: t("assetSchedules.actions.processDue"),
                    icon: PlayCircle,
                    hidden: !canEdit,
                    loading: processDue.busy,
                    onSelect: () => setDialog("process"),
                  }
                : undefined
          }
          secondary={[
            {
              key: "link",
              label: t("assetSchedules.actions.linkInvoiceLine"),
              icon: Link2,
              hidden: !canEdit || !isDraft || isLinked,
              onSelect: openLink,
            },
            {
              key: "unlink",
              label: t("assetSchedules.actions.unlinkInvoiceLine"),
              icon: Unlink,
              hidden: !canEdit || !isDraft || !isLinked,
              disabled: busy,
              onSelect: () =>
                void act(
                  () => fixedAssetsService.unlinkInvoiceLine(asset.id),
                  "assetSchedules.toasts.unlinked",
                ),
            },
          ]}
          destructive={[
            {
              key: "dispose",
              label: t("masterData.fixedAssets.actions.dispose"),
              icon: Trash2,
              hidden: !canEdit || asset.status !== "CAPITALIZED",
              onSelect: openDispose,
            },
          ]}
        />
      }
    >
      <RelatedDocuments groups={relatedGroups} />
      {isDraft && isLinked && asset.purchaseInvoice ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-caption text-muted-foreground">
          {t("assetSchedules.dialogs.linkedNotice", {
            invoice: asset.purchaseInvoice.invoiceNumber,
          })}
        </p>
      ) : null}
      {asset.purchaseReturn ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-caption text-muted-foreground">
          {t("assetSchedules.dialogs.returnedNotice", {
            return: asset.purchaseReturn.returnNumber,
          })}
        </p>
      ) : null}

      <DetailSummaryBar>
        <DetailField
          label={t("masterData.fixedAssets.fields.cost")}
          value={<MoneyValue value={summary.cost} />}
        />
        {summary.costAdditions > 0 ? (
          <DetailField
            label={t("assetSchedules.fields.costAdditions")}
            value={<MoneyValue value={summary.costAdditions} />}
          />
        ) : null}
        <DetailField
          label={t("masterData.fixedAssets.fields.salvageValue")}
          value={<MoneyValue value={summary.salvageValue} />}
        />
        <DetailField
          label={t("masterData.fixedAssets.fields.accumulatedDepreciation")}
          value={<MoneyValue value={summary.accumulatedDepreciation} />}
        />
        <DetailField
          label={t("assetSchedules.fields.bookValue")}
          value={<MoneyValue value={summary.bookValue} />}
        />
        <DetailField
          label={t("assetSchedules.fields.remainingDepreciable")}
          value={<MoneyValue value={summary.remainingDepreciable} />}
        />
        <DetailField
          label={t("assetSchedules.fields.periodsPosted")}
          value={
            <span className="num" dir="ltr">
              {summary.postedPeriods} / {asset.depreciationPeriods.length}
            </span>
          }
        />
      </DetailSummaryBar>

      <DetailSection title={t("assetSchedules.sections.parameters")}>
        <DetailFieldGrid columns={3}>
          <DetailField
            label={t("assetSchedules.fields.method")}
            value={t(`assetSchedules.methods.${asset.depreciationMethod ?? "STRAIGHT_LINE"}`)}
          />
          <DetailField
            label={t("masterData.fixedAssets.fields.usefulLifeMonths")}
            value={asset.usefulLifeMonths != null ? String(asset.usefulLifeMonths) : null}
          />
          <DetailField
            label={t("masterData.fixedAssets.fields.depreciationStartDate")}
            value={formatDate(asset.depreciationStartDate)}
          />
          <DetailField
            label={t("masterData.fixedAssets.fields.acquisitionDate")}
            value={formatDate(asset.acquisitionDate)}
          />
          <DetailField
            label={t("masterData.expenses.fields.costCenter")}
            value={asset.costCenter?.name}
          />
          <DetailField
            label={t("masterData.fixedAssets.fields.partner")}
            value={asset.partner?.name}
          />
          <DetailField
            label={t("masterData.fixedAssets.fields.receivingAccount")}
            value={asset.receivingAccount?.name}
          />
          <DetailField
            label={t("assetSchedules.fields.sourceLine")}
            value={
              sourceLine
                ? [
                    sourceLine.description?.trim() ||
                      sourceLine.product?.displayName ||
                      sourceLine.product?.name,
                    formatMoney(Number(sourceLine.lineTotal) - Number(sourceLine.taxAmount)),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null
            }
          />
          <DetailField
            label={t("assetSchedules.fields.disposalDate")}
            value={formatDate(asset.disposedAt)}
          />
          <DetailField
            label={t("masterData.fixedAssets.fields.disposalAmount")}
            value={
              asset.status === "DISPOSED" ? <MoneyValue value={asset.disposalAmount ?? 0} /> : null
            }
          />
          {asset.disposalPartner ? (
            <DetailField
              label={t("assetSchedules.fields.supplierToCredit")}
              value={asset.disposalPartner.name}
            />
          ) : null}
          <DetailField
            label={t("assetSchedules.fields.disposalNotes")}
            value={asset.disposalNotes}
          />
          <DetailField
            label={t("masterData.fields.notes")}
            value={asset.notes}
            className="sm:col-span-2"
          />
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={t("assetSchedules.sections.schedule")}>
        <AccountingScheduleTable rows={asset.depreciationPeriods} />
      </DetailSection>

      <ConfirmationDialog
        open={dialog === "capitalize"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("masterData.fixedAssets.actions.capitalize")}
        description={t("assetSchedules.dialogs.capitalizeDescription")}
        size="lg"
        extra={
          <div className="flex flex-col gap-2 px-6">
            {previewError ? (
              <p className="text-caption text-warning-foreground">{previewError}</p>
            ) : preview ? (
              <>
                <p className="text-caption text-muted-foreground">
                  {t(`assetSchedules.methods.${preview.method}`)} ·{" "}
                  {t("assetSchedules.sections.previewSummary", {
                    count: preview.periods.length,
                    start: formatDate(preview.startDate),
                    end: formatDate(preview.endDate),
                  })}
                </p>
                <div className="max-h-72 overflow-y-auto">
                  <SchedulePreviewTable
                    rows={preview.periods}
                    remainingLabel={t("assetSchedules.columns.bookValue")}
                  />
                </div>
              </>
            ) : (
              <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
            )}
          </div>
        }
        confirmLabel={t("masterData.fixedAssets.actions.capitalize")}
        confirmDisabled={!preview}
        isConfirming={busy}
        onConfirm={() =>
          void act(
            () =>
              fixedAssetsService.capitalize(asset.id, {
                usefulLifeMonths: preview?.usefulLifeMonths ?? asset.usefulLifeMonths,
                depreciationMethod: preview?.method,
                salvageValue: preview?.salvageValue,
                depreciationStartDate: preview?.startDate ?? undefined,
              }),
            "masterData.fixedAssets.toasts.capitalized",
          )
        }
      />

      <ConfirmationDialog
        open={dialog === "dispose"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("masterData.fixedAssets.actions.dispose")}
        description={t("assetSchedules.dialogs.disposeDescription")}
        tone="warning"
        extra={
          <div className="grid grid-cols-1 gap-3 px-6 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-muted-foreground">
                {t("assetSchedules.fields.disposalDate")}
              </span>
              <EnterpriseDatePicker value={disposalDate} onChange={setDisposalDate} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-muted-foreground">
                {t("masterData.fixedAssets.fields.disposalAmount")}
              </span>
              <MoneyInput
                min={0}
                value={disposalAmount}
                onChange={(event) => setDisposalAmount(event.target.value)}
              />
            </label>
            {Number(disposalAmount) > 0 ? (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-caption text-muted-foreground">
                  {t("assetSchedules.fields.settlement")}
                </span>
                <SegmentedRadioGroup<Settlement>
                  value={settlement}
                  onValueChange={setSettlement}
                  options={(["CASH", "SUPPLIER_CREDIT"] as const).map((value) => ({
                    value,
                    label: t(`assetSchedules.settlement.${value}`),
                  }))}
                  aria-label={t("assetSchedules.fields.settlement")}
                />
              </div>
            ) : null}
            {Number(disposalAmount) > 0 && settlement === "CASH" ? (
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-caption text-muted-foreground">
                  {t("masterData.fixedAssets.fields.receivingAccount")}
                </span>
                <SearchableSelect
                  value={disposalAccountId}
                  onValueChange={setDisposalAccountId}
                  options={receivingAccounts.map((account) => ({
                    value: account.id,
                    label: account.name,
                  }))}
                  aria-label={t("masterData.fixedAssets.fields.receivingAccount")}
                />
              </label>
            ) : null}
            {Number(disposalAmount) > 0 && settlement === "SUPPLIER_CREDIT" ? (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-caption text-muted-foreground">
                  {t("assetSchedules.fields.supplierToCredit")}
                </span>
                <PartnerPicker
                  role="SUPPLIER"
                  value={creditSupplier}
                  onChange={setCreditSupplier}
                />
                <p className="text-caption text-muted-foreground">
                  {t("assetSchedules.dialogs.disposeSupplierHint")}
                </p>
              </div>
            ) : null}
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-caption text-muted-foreground">
                {t("assetSchedules.fields.disposalNotes")}
              </span>
              <Textarea
                rows={2}
                value={disposalNotes}
                onChange={(event) => setDisposalNotes(event.target.value)}
              />
            </label>
          </div>
        }
        confirmLabel={t("masterData.fixedAssets.actions.dispose")}
        confirmDisabled={
          !disposalDate ||
          (Number(disposalAmount) > 0 &&
            (settlement === "CASH" ? !disposalAccountId : !creditSupplier))
        }
        isConfirming={busy}
        onConfirm={() =>
          void act(
            () =>
              fixedAssetsService.dispose(asset.id, {
                disposalDate: toIsoDate(disposalDate),
                disposalAmount: Number(disposalAmount || 0),
                ...(Number(disposalAmount) > 0 && settlement === "SUPPLIER_CREDIT"
                  ? { counterpartyPartnerId: creditSupplier?.id }
                  : { receivingAccountId: disposalAccountId || undefined }),
                disposalNotes: disposalNotes.trim() || undefined,
              }),
            "masterData.fixedAssets.toasts.disposed",
          )
        }
      />

      <ConfirmationDialog
        open={dialog === "process"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("assetSchedules.actions.processDue")}
        description={t("assetSchedules.dialogs.processDueDescription")}
        confirmLabel={t("assetSchedules.actions.processDue")}
        isConfirming={processDue.busy}
        onConfirm={() => void processDue.run().then(() => setDialog(null))}
      />

      <ConfirmationDialog
        open={dialog === "link"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("assetSchedules.actions.linkInvoiceLine")}
        description={t("assetSchedules.dialogs.linkDescription")}
        extra={
          <div className="px-6">
            <SearchableSelect
              value={lineId}
              onValueChange={setLineId}
              loading={linkableLines === null}
              options={(linkableLines ?? []).map((line) => ({
                value: line.id,
                label: lineLabel(line),
              }))}
              placeholder={t("assetSchedules.dialogs.linkPlaceholder")}
              emptyText={t("assetSchedules.dialogs.noLinkableLines")}
              aria-label={t("assetSchedules.actions.linkInvoiceLine")}
            />
          </div>
        }
        confirmLabel={t("assetSchedules.actions.linkInvoiceLine")}
        confirmDisabled={!lineId}
        isConfirming={busy}
        onConfirm={() =>
          void act(
            () => fixedAssetsService.linkInvoiceLine(asset.id, lineId),
            "assetSchedules.toasts.linked",
          )
        }
      />
    </DetailWorkspace>
  );
}

export default function FixedAssetDetailPage() {
  return (
    <PermissionGate permission="masterdata.fixed-assets.view">
      <FixedAssetDetailContent />
    </PermissionGate>
  );
}
