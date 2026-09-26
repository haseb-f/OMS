"use client";

import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, PackageCheck, Plus, Save, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import {
  PurchaseInvoicePicker,
  type PurchaseInvoiceOption,
} from "@/components/business/purchase-invoice-picker";
import { CostCategoryPicker } from "@/components/business/cost-category-picker";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { useTaxes } from "@/hooks/use-reference-data";
import { cachedLookup } from "@/lib/lookup-cache";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorWorkspace, EditorHeader, DetailSection } from "@/components/shared/detail-workspace";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import {
  landedCostService,
  type LandedCostDocumentRow,
  type LandedCostAllocationMethodValue,
  type AllocationPreview,
} from "@/services/landed-cost-service";
import { createMasterDataService } from "@/services/master-data-service";
import { partnersService } from "@/services/partners-service";
import { type CostComponentRow, type TaxRow } from "@/config/master-data/entities";
import {
  LANDED_COST_CANCELLABLE_STATUSES,
  LANDED_COST_STATUS_LABEL_KEY,
  LANDED_COST_STATUS_TONE,
} from "@/config/purchasing/landed-cost-status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDateTime, toISODate } from "@/lib/date";
import { ApiError } from "@/services/api-client";

const costComponentsService = createMasterDataService<CostComponentRow>("/cost-components");

interface ProviderOption {
  id: string;
  name: string;
}

interface LineDraft {
  key: string;
  costComponent: CostComponentRow | null;
  description: string;
  netAmount: string;
  tax: TaxRow | null;
}

function emptyLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    costComponent: null,
    description: "",
    netAmount: "",
    tax: null,
  };
}

export function LandedCostEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  const [record, setRecord] = useState<LandedCostDocumentRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const [purchaseInvoice, setPurchaseInvoice] = useState<PurchaseInvoiceOption | null>(null);
  const [provider, setProvider] = useState<ProviderOption | null>(null);
  const [currencyId, setCurrencyId] = useState("");
  const [documentDate, setDocumentDate] = useState<Date | null>(new Date());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [allocationMethod, setAllocationMethod] =
    useState<LandedCostAllocationMethodValue>("BY_COST");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const [costComponents, setCostComponents] = useState<CostComponentRow[]>([]);
  const taxes = useTaxes();
  const fieldId = useId();
  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  useEffect(() => {
    costComponentsService
      .list({ pageSize: 500 })
      .then((result) => setCostComponents(result.items))
      .catch(() => setCostComponents([]));
  }, []);

  const applyDocument = useCallback((data: LandedCostDocumentRow) => {
    setRecord(data);
    setPurchaseInvoice(
      data.purchaseInvoice
        ? { id: data.purchaseInvoiceId, invoiceNumber: data.purchaseInvoice.invoiceNumber }
        : null,
    );
    setProvider(data.provider ? { id: data.provider.id, name: data.provider.name } : null);
    setCurrencyId(data.currencyId ?? "");
    setDocumentDate(new Date(data.documentDate));
    setReferenceNumber(data.referenceNumber ?? "");
    setAllocationMethod(data.allocationMethod);
    setLines(
      data.lines.length > 0
        ? data.lines.map((line) => ({
            key: line.id,
            costComponent: line.costComponent ?? null,
            description: line.description ?? "",
            netAmount: String(line.netAmount),
            tax: line.tax ?? null,
          }))
        : [emptyLine()],
    );
  }, []);

  const refreshPreview = useCallback((documentId: string) => {
    setIsPreviewLoading(true);
    landedCostService
      .previewAllocation(documentId)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setIsPreviewLoading(false));
  }, []);

  useEffect(() => {
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    landedCostService
      .get(id)
      .then((data) => {
        applyDocument(data);
        refreshPreview(id);
      })
      .catch((error) => {
        toast.error(
          error instanceof ApiError ? error.message : "Failed to load Landed Cost document.",
        );
      })
      .finally(() => setIsLoading(false));
  }, [id, applyDocument, refreshPreview]);

  /** A fresh document inherits the Purchase Invoice's own currency — same convention as every other purchasing document. */
  const handlePurchaseInvoiceChange = (invoice: PurchaseInvoiceOption | null) => {
    setPurchaseInvoice(invoice);
    if (!id && invoice?.currency && !currencyId) setCurrencyId(invoice.currency.id);
  };

  const realLines = lines.filter((line) => line.costComponent !== null);

  const validate = (): string | null => {
    if (!purchaseInvoice) return t("purchasing.landedCost.validation.purchaseInvoiceRequired");
    if (!currencyId) return t("purchasing.landedCost.validation.currencyRequired");
    if (realLines.length === 0) return t("purchasing.landedCost.validation.lineRequired");
    for (const line of realLines) {
      const amount = Number(line.netAmount);
      if (!amount || amount <= 0) return t("purchasing.landedCost.validation.lineAmountPositive");
    }
    return null;
  };

  const buildPayload = () => ({
    purchaseInvoiceId: purchaseInvoice!.id,
    providerId: provider?.id,
    currencyId,
    referenceNumber: referenceNumber || undefined,
    documentDate: toISODate(documentDate ?? new Date()),
    allocationMethod,
    lines: realLines.map((line) => ({
      costComponentId: line.costComponent!.id,
      description: line.description || undefined,
      netAmount: Number(line.netAmount),
      taxId: line.tax?.id,
    })),
  });

  const handleSave = async () => {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    setIsSaving(true);
    try {
      if (id) {
        const updated = await landedCostService.update(id, buildPayload());
        applyDocument(updated);
        refreshPreview(id);
        toast.success(t("purchasing.landedCost.toasts.saved"));
      } else {
        const created = await landedCostService.create(buildPayload());
        toast.success(t("purchasing.landedCost.toasts.created"));
        router.replace(`/purchasing/landed-cost/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (documentId: string) => Promise<LandedCostDocumentRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyDocument(updated);
      refreshPreview(id);
      toast.success(t(successKey));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const canEdit = !record || record.status === "DRAFT";
  const canApprove = hasPermission("landed-cost.approve") && record?.status === "DRAFT";
  const canPost = hasPermission("landed-cost.confirm") && record?.status === "APPROVED";
  const canCancel =
    hasPermission("landed-cost.cancel") &&
    !!record &&
    LANDED_COST_CANCELLABLE_STATUSES.includes(record.status);

  useBreadcrumbLabel(record?.documentNumber ?? t("purchasing.landedCost.addNew"));

  const netTotal = realLines.reduce((sum, line) => sum + (Number(line.netAmount) || 0), 0);

  return (
    <EditorWorkspace>
      <RelatedRecordsPanel kind="LANDED_COST" id={id} refreshKey={record?.status} />

      <EditorHeader
        title={t("purchasing.landedCost.editorTitle")}
        documentNumber={record?.documentNumber}
        status={
          record && (
            <StatusBadge
              label={t(LANDED_COST_STATUS_LABEL_KEY[record.status])}
              tone={LANDED_COST_STATUS_TONE[record.status]}
            />
          )
        }
        actions={
          <>
            {canEdit && (
              <EnterpriseButton
                type="button"
                size="sm"
                disabled={isSaving || isTransitioning || isLoading}
                onClick={handleSave}
              >
                <Save className="size-3.5" />
                {t("common.save")}
              </EnterpriseButton>
            )}
            {canApprove && (
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                disabled={isTransitioning}
                onClick={() =>
                  runTransition(
                    (docId) => landedCostService.approve(docId),
                    "purchasing.landedCost.toasts.approved",
                  )
                }
              >
                <CheckCircle2 className="size-3.5" />
                {t("purchasing.landedCost.actions.approve")}
              </EnterpriseButton>
            )}
            {canPost && (
              <EnterpriseButton
                type="button"
                size="sm"
                disabled={isTransitioning}
                onClick={() =>
                  runTransition(
                    (docId) => landedCostService.post(docId),
                    "purchasing.landedCost.toasts.posted",
                  )
                }
              >
                <PackageCheck className="size-3.5" />
                {t("purchasing.landedCost.actions.post")}
              </EnterpriseButton>
            )}
            {canCancel && (
              <EnterpriseButton
                type="button"
                size="sm"
                variant="destructive"
                disabled={isTransitioning}
                onClick={() => setCancelOpen(true)}
              >
                <Ban className="size-3.5" />
                {t("purchasing.landedCost.actions.cancel")}
              </EnterpriseButton>
            )}
          </>
        }
      />

      <DetailSection title={t("purchasing.landedCost.editorTitle")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-invoice`}>
              {t("purchasing.landedCost.fields.purchaseInvoice")}
            </Label>
            <PurchaseInvoicePicker
              id={`${fieldId}-invoice`}
              value={purchaseInvoice}
              onChange={handlePurchaseInvoiceChange}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-provider`}>
              {t("purchasing.landedCost.fields.provider")}
            </Label>
            {/* Any partner may bill a landed cost (carrier, customs broker, supplier…) — no single role fits, so this stays a role-less partner search. */}
            <EntityCombobox
              id={`${fieldId}-provider`}
              value={provider}
              onChange={setProvider}
              onSearch={async (search) => {
                const params = { search: search || undefined, pageSize: 20 };
                const result = await cachedLookup(`partners:${JSON.stringify(params)}`, () =>
                  partnersService.catalog(params),
                );
                return result.items;
              }}
              getId={(partner) => partner.id}
              getTitle={(partner) => partner.name}
              placeholder={t("common.select")}
              searchPlaceholder={t("common.search")}
              emptyText={t("common.noResults")}
              disabled={!canEdit}
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-currency`}>
              {t("purchasing.landedCost.fields.currency")}
            </Label>
            <CurrencyPicker
              id={`${fieldId}-currency`}
              valueKey="id"
              value={currencyId}
              onValueChange={setCurrencyId}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-reference`}>
              {t("purchasing.landedCost.fields.reference")}
            </Label>
            <Input
              id={`${fieldId}-reference`}
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("purchasing.landedCost.fields.date")}</Label>
            <EnterpriseDatePicker
              value={documentDate}
              onChange={setDocumentDate}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-allocation`}>
              {t("purchasing.landedCost.fields.allocationMethod")}
            </Label>
            <Select
              value={allocationMethod}
              onValueChange={(value) =>
                setAllocationMethod(value as LandedCostAllocationMethodValue)
              }
              disabled={!canEdit}
            >
              <SelectTrigger id={`${fieldId}-allocation`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BY_COST">
                  {t("purchasing.landedCost.allocationMethods.BY_COST")}
                </SelectItem>
                <SelectItem value="BY_QUANTITY">
                  {t("purchasing.landedCost.allocationMethods.BY_QUANTITY")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </DetailSection>

      <DetailSection title={t("purchasing.landedCost.lines.title")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("purchasing.landedCost.lines.costComponent")}</TableHead>
              <TableHead>{t("purchasing.landedCost.lines.description")}</TableHead>
              <TableHead className="w-32">{t("purchasing.landedCost.lines.netAmount")}</TableHead>
              <TableHead className="w-40">{t("purchasing.landedCost.lines.tax")}</TableHead>
              {canEdit && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.key}>
                <TableCell>
                  <CostCategoryPicker
                    aria-label={t("purchasing.landedCost.lines.costComponent")}
                    value={line.costComponent}
                    items={costComponents}
                    disabled={!canEdit}
                    onChange={(category) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, costComponent: category } : l,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={t("purchasing.landedCost.lines.description")}
                    value={line.description}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, description: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={t("purchasing.landedCost.lines.netAmount")}
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.netAmount}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, netAmount: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <EntityCombobox
                    value={line.tax}
                    items={taxes}
                    triggerProps={{ "aria-label": t("purchasing.landedCost.lines.tax") }}
                    disabled={!canEdit}
                    allowClear
                    getId={(tax) => tax.id}
                    getTitle={(tax) => `${tax.name} (${tax.rate}%)`}
                    placeholder={t("common.none")}
                    searchPlaceholder={t("common.search")}
                    emptyText={t("common.noResults")}
                    onChange={(tax) =>
                      setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, tax } : l)))
                    }
                  />
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <EnterpriseButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.remove")}
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 className="size-3.5" />
                    </EnterpriseButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="text-end font-medium">
                {t("purchasing.landedCost.fields.netTotal")}
              </TableCell>
              <TableCell className="font-medium">
                {netTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell colSpan={canEdit ? 2 : 1} />
            </TableRow>
          </TableFooter>
        </Table>
        {canEdit && (
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-fit"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
          >
            <Plus className="size-3.5" />
            {t("purchasing.landedCost.actions.addLine")}
          </EnterpriseButton>
        )}
      </DetailSection>

      {record && (
        <DetailSection title={t("purchasing.landedCost.allocationPreview.title")}>
          {isPreviewLoading || !preview ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("purchasing.landedCost.allocationPreview.product")}</TableHead>
                    <TableHead>{t("purchasing.landedCost.allocationPreview.quantity")}</TableHead>
                    <TableHead>
                      {t("purchasing.landedCost.allocationPreview.purchaseValue")}
                    </TableHead>
                    <TableHead>
                      {t("purchasing.landedCost.allocationPreview.allocatedAmount")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lines.map((line) => (
                    <TableRow key={line.purchaseInvoiceItemId}>
                      <TableCell>{line.productName}</TableCell>
                      <TableCell>{line.quantity}</TableCell>
                      <TableCell>
                        {line.purchaseValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        {line.allocatedAmount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="text-end font-medium">
                      {t("purchasing.landedCost.allocationPreview.total")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {preview.allocatedTotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              <p
                className={
                  preview.difference === 0
                    ? "mt-2 text-caption text-success"
                    : "mt-2 text-caption text-destructive"
                }
              >
                {preview.difference === 0
                  ? t("purchasing.landedCost.allocationPreview.reconciled")
                  : t("purchasing.landedCost.allocationPreview.notReconciled")}
              </p>
            </>
          )}
        </DetailSection>
      )}

      {record?.activities && record.activities.length > 0 && (
        <DetailSection title={t("masterData.actions.viewActivity")}>
          <ul className="flex flex-col gap-2">
            {record.activities.map((activity) => (
              <li key={activity.id} className="text-caption text-muted-foreground">
                <span className="text-foreground">{activity.description}</span>
                {" — "}
                {formatDateTime(activity.createdAt)}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      <ConfirmationDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="destructive"
        title={t("purchasing.landedCost.confirmCancelTitle")}
        description={t("purchasing.landedCost.confirmCancelDescription")}
        confirmLabel={t("purchasing.landedCost.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelOpen(false);
          await runTransition(
            (docId) => landedCostService.cancel(docId),
            "purchasing.landedCost.toasts.cancelled",
          );
        }}
      />
    </EditorWorkspace>
  );
}
