"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle, Ban, CheckCircle2, Printer, Save, Send } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PurchasingDocumentEditor } from "@/components/purchasing/purchasing-document-editor";
import {
  createEmptyLine,
  type ProductLineItemsGridLine,
} from "@/components/sales/product-line-items-grid";
import type { DocumentTotals } from "@/components/sales/document-totals-footer";
import type {
  PurchaseDocumentEditorConfig,
  PurchaseDocumentEditorHandlers,
  PurchaseDocumentEditorState,
  PurchaseDocumentActivityEntry,
} from "@/components/purchasing/purchasing-document-editor.types";
import {
  purchaseQuotationsService,
  type PurchaseQuotationItemRow,
  type PurchaseQuotationRow,
} from "@/services/purchase-quotations-service";
import type { SupplierRow } from "@/services/suppliers-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildQuotationStatusOptions } from "@/config/purchasing/quotation-status";
import { buildQuotationPrintPayload } from "@/config/purchasing/quotation-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

function itemToLine(item: PurchaseQuotationItemRow): ProductLineItemsGridLine {
  return {
    id: item.id,
    product: item.product ?? null,
    description: item.description ?? null,
    warehouse: null,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    discountPercent: Number(item.discountPercent),
    taxId: item.taxId,
    unitId: item.unitId,
    unitName: item.unit?.name ?? null,
  };
}

function lineToPayload(line: ProductLineItemsGridLine) {
  return {
    productId: line.product!.id,
    description: line.description || undefined,
    unitId: line.unitId ?? line.product!.unitId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    taxId: line.taxId ?? undefined,
  };
}

/** Mirrors `sales/quotations/quotation-editor-page.tsx` — Purchase Quotation has no per-line Warehouse (PurchaseOrderItem precedent, ADR-0015) and "Convert to Order" needs no line selection (the whole quotation converts as-is), so it reuses the plain `ConfirmationDialog` rather than a bespoke convert dialog. */
export function QuotationEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [quotation, setQuotation] = useState<PurchaseQuotationRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<PurchaseDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState(false);
  const [convertTarget, setConvertTarget] = useState(false);

  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [documentDate, setDocumentDate] = useState<Date | null>(new Date());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyQuotation = useCallback((data: PurchaseQuotationRow) => {
    setQuotation(data);
    setSupplier(data.supplier ?? null);
    setCurrency(data.currency ?? null);
    setDocumentDate(new Date(data.documentDate));
    setReferenceNumber(data.referenceNumber ?? "");
    setNotes(data.internalNotes ?? "");
    setTerms(data.supplierNotes ?? "");
    setLines(data.items.length > 0 ? data.items.map(itemToLine) : [createEmptyLine()]);
  }, []);

  useEffect(() => {
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      setActivity([]);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await purchaseQuotationsService.get(id);
        applyQuotation(data);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Failed to load quotation.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyQuotation]);

  const refreshActivity = useCallback((quotationId: string) => {
    purchaseQuotationsService
      .activities(quotationId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  const validate = (): string | null => {
    if (!supplier) return t("purchasing.quotations.validation.supplierRequired");
    if (realLines.length === 0) return t("purchasing.quotations.validation.productRequired");
    for (const line of realLines) {
      if (line.quantity <= 0) return t("purchasing.quotations.validation.quantityPositive");
    }
    return null;
  };

  const buildPayload = () => ({
    supplierId: supplier!.id,
    currencyId: currency?.id,
    // Classification-only field (schema comment: "no business logic yet") —
    // defaulted, not exposed in the fastest-entry UI, per the UX Policy's
    // "hide unnecessary fields, prefer smart defaults."
    purchaseType: "INVENTORY" as const,
    documentDate: documentDate ? documentDate.toISOString() : undefined,
    referenceNumber: referenceNumber || undefined,
    internalNotes: notes || undefined,
    supplierNotes: terms || undefined,
    items: realLines.map(lineToPayload),
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
        const updated = await purchaseQuotationsService.update(id, buildPayload());
        applyQuotation(updated);
        toast.success(t("common.save"));
      } else {
        const created = await purchaseQuotationsService.create(buildPayload());
        toast.success(t("common.save"));
        router.replace(`/purchasing/purchase-quotations/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (quotationId: string) => Promise<PurchaseQuotationRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyQuotation(updated);
      toast.success(t(successKey));
      refreshActivity(id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleConvertConfirmed = async () => {
    if (!id) return;
    setConvertTarget(false);
    setIsTransitioning(true);
    try {
      const order = await purchaseQuotationsService.convertToOrder(id);
      toast.success(t("purchasing.quotations.convertToOrder.success"));
      router.push(`/purchasing/purchase-orders/${order.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!quotation) return;
    const payload = buildQuotationPrintPayload(quotation, {
      companyName: activeCompany?.name ?? "",
      companyLogoUrl: activeCompany?.logoUrl ?? null,
      printedByName: user?.fullName ?? null,
      t,
    });
    printDocument(payload);
  };

  const totals: DocumentTotals | null = quotation
    ? {
        subtotal: Number(quotation.subtotal),
        discountTotal: Number(quotation.discountTotal),
        taxTotal: Number(quotation.taxTotal),
        grandTotal: Number(quotation.grandTotal),
      }
    : null;

  const config: PurchaseDocumentEditorConfig<PurchaseQuotationRow> = useMemo(
    () => ({
      title: t("purchasing.quotations.editorTitle"),
      documentType: "PURCHASE_QUOTATION",
      permissions: {
        create: "purchasing.quotations.create",
        edit: "purchasing.quotations.edit",
        approve: "purchasing.quotations.approve",
        cancel: "purchasing.quotations.cancel",
      },
      statusOptions: buildQuotationStatusOptions(t),
      numbering: { documentType: "PURCHASE_QUOTATION", docCodePreview: "PQ" },
      requireWarehouse: false,
      toolbarExtra: (
        <EnterpriseButton
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={isSaving || isTransitioning || (!!quotation && quotation.status !== "DRAFT")}
          onClick={handleSave}
        >
          <Save className="size-3.5" />
          {t("common.save")}
        </EnterpriseButton>
      ),
      workflowActions: [
        {
          key: "submit",
          label: t("purchasing.quotations.actions.submit"),
          icon: Send,
          variant: "outline",
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition(
              (qid) => purchaseQuotationsService.submit(qid),
              "purchasing.quotations.toasts.submitted",
            ),
        },
        {
          key: "approve",
          label: t("purchasing.quotations.actions.approve"),
          icon: CheckCircle2,
          variant: "outline",
          visibleForStatuses: ["PENDING_APPROVAL"],
          onAction: () =>
            runTransition(
              (qid) => purchaseQuotationsService.approve(qid),
              "purchasing.quotations.toasts.approved",
            ),
        },
        {
          key: "convert",
          label: t("purchasing.quotations.actions.convertToOrder"),
          icon: ArrowRightCircle,
          variant: "outline",
          visibleForStatuses: ["APPROVED"],
          onAction: () => setConvertTarget(true),
        },
        {
          key: "cancel",
          label: t("purchasing.quotations.actions.cancel"),
          icon: Ban,
          variant: "destructive",
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
          onAction: () => setCancelTarget(true),
        },
        {
          key: "print",
          label: t("table.print"),
          icon: Printer,
          variant: "outline",
          onAction: () => handlePrint(),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      isSaving,
      isTransitioning,
      quotation,
      supplier,
      currency,
      lines,
      documentDate,
      referenceNumber,
      notes,
      terms,
    ],
  );

  const state: PurchaseDocumentEditorState<PurchaseQuotationRow> = {
    document: quotation,
    documentNumber: quotation?.quotationNumber ?? null,
    status: quotation?.status ?? "DRAFT",
    documentDate,
    supplier,
    currency,
    referenceNumber,
    notes,
    terms,
    lines,
    totals,
  };

  const handlers: PurchaseDocumentEditorHandlers = {
    onDocumentDateChange: setDocumentDate,
    onSupplierChange: setSupplier,
    onCurrencyChange: setCurrency,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onTermsChange: setTerms,
    onLinesChange: setLines,
  };

  const canEdit = !quotation || quotation.status === "DRAFT";
  const canApprove = hasPermission("purchasing.quotations.approve");
  const canCancel = hasPermission("purchasing.quotations.cancel");

  useBreadcrumbLabel(quotation?.quotationNumber ?? t("purchasing.quotations.addNew"));

  return (
    <div className="flex flex-col gap-3">
      <PurchasingDocumentEditor
        config={{
          ...config,
          workflowActions: config.workflowActions.filter((action) => {
            if (action.key === "approve" && !canApprove) return false;
            if (action.key === "cancel" && !canCancel) return false;
            if (action.key === "print" && !quotation) return false;
            return true;
          }),
        }}
        state={state}
        handlers={handlers}
        activity={activity}
        isLoading={isLoading}
        disabled={!canEdit || isSaving}
        isBusy={isSaving || isTransitioning}
      />

      <ConfirmationDialog
        open={cancelTarget}
        onOpenChange={setCancelTarget}
        tone="destructive"
        title={t("purchasing.quotations.confirmCancelTitle")}
        description={t("purchasing.quotations.confirmCancelDescription")}
        confirmLabel={t("purchasing.quotations.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelTarget(false);
          await runTransition(
            (qid) => purchaseQuotationsService.cancel(qid),
            "purchasing.quotations.toasts.cancelled",
          );
        }}
      />

      <ConfirmationDialog
        open={convertTarget}
        onOpenChange={setConvertTarget}
        title={t("purchasing.quotations.convertToOrder.title")}
        description={t("purchasing.quotations.convertToOrder.description")}
        confirmLabel={t("purchasing.quotations.convertToOrder.confirm")}
        cancelLabel={t("common.close")}
        onConfirm={handleConvertConfirmed}
      />
    </div>
  );
}
