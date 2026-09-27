"use client";

import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, PackageMinus, Printer, Save, Send } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EditorWorkspace } from "@/components/shared/detail-workspace";
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
  purchaseReturnsService,
  type PurchaseReturnItemRow,
  type PurchaseReturnRow,
} from "@/services/purchase-returns-service";
import type { PartnerPickerRow } from "@/services/partners-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildReturnStatusOptions } from "@/config/purchasing/return-status";
import { buildReturnPrintPayload } from "@/config/purchasing/return-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";
import type { CommercialDocumentFieldErrors } from "@/components/documents/commercial-document-editor";

function itemToLine(item: PurchaseReturnItemRow): ProductLineItemsGridLine {
  return {
    id: item.id,
    product: item.product ?? null,
    description: item.description ?? null,
    warehouse: item.warehouse ?? null,
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
    warehouseId: line.warehouse?.id,
    unitId: line.unitId ?? line.product!.unitId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    taxId: line.taxId ?? undefined,
  };
}

/**
 * Mirrors the Sales Return editor — "Confirm" decreases inventory (goods
 * going back to the Supplier). Terminal document: no outgoing conversion.
 * TASK-048 — a Purchase Return is never created blank here; the only
 * creation path is the "Create Return" dialog on an open Purchase Invoice.
 * This page only ever edits an existing (already invoice-linked) Draft
 * return, so `id` is always a real return id, never null.
 */
export function ReturnEditorPage({ id }: { id: string }) {
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [purchaseReturn, setPurchaseReturn] = useState<PurchaseReturnRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<PurchaseDocumentActivityEntry[] | null | undefined>(
    undefined,
  );

  const [supplier, setSupplier] = useState<PartnerPickerRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [documentDate, setDocumentDate] = useState<Date | null>(new Date());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyReturn = useCallback((data: PurchaseReturnRow) => {
    setPurchaseReturn(data);
    setSupplier(data.partner ?? null);
    setCurrency(data.currency ?? null);
    setDocumentDate(new Date(data.createdAt));
    setReferenceNumber(data.referenceNumber ?? "");
    setNotes(data.internalNotes ?? "");
    setTerms(data.supplierNotes ?? "");
    setLines(data.items.length > 0 ? data.items.map(itemToLine) : [createEmptyLine()]);
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        applyReturn(await purchaseReturnsService.get(id));
      } catch (error) {
        reportApiError(error, "errors.loadFailed");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyReturn]);

  const refreshActivity = useCallback((returnId: string) => {
    purchaseReturnsService
      .activities(returnId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  /** Shown inline under the fields after the first save attempt; entered data is never cleared. */
  const [showValidation, setShowValidation] = useState(false);
  const validate = (): CommercialDocumentFieldErrors | null => {
    if (!supplier) return { party: t("purchasing.returns.validation.supplierRequired") };
    if (realLines.length === 0)
      return { lines: t("purchasing.returns.validation.productRequired") };
    for (const line of realLines) {
      if (line.quantity <= 0) return { lines: t("purchasing.returns.validation.quantityPositive") };
      if (!line.warehouse) return { lines: t("sales.editor.grid.warehouseRequired") };
    }
    return null;
  };

  const buildPayload = () => ({
    partnerId: supplier!.id,
    currencyId: currency?.id,
    referenceNumber: referenceNumber || undefined,
    internalNotes: notes || undefined,
    supplierNotes: terms || undefined,
    items: realLines.map(lineToPayload),
  });

  const handleSave = async () => {
    if (validate()) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);
    setIsSaving(true);
    try {
      const updated = await purchaseReturnsService.update(id, buildPayload());
      applyReturn(updated);
      reportSuccess(t("common.saved"));
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (returnId: string) => Promise<PurchaseReturnRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyReturn(updated);
      reportSuccess(t(successKey));
      refreshActivity(id);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!purchaseReturn) return;
    printDocument(
      buildReturnPrintPayload(purchaseReturn, {
        companyName: activeCompany?.name ?? "",
        companyLogoUrl: activeCompany?.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  const totals: DocumentTotals | null = purchaseReturn
    ? {
        subtotal: Number(purchaseReturn.subtotal),
        discountTotal: Number(purchaseReturn.discountTotal),
        taxTotal: Number(purchaseReturn.taxTotal),
        grandTotal: Number(purchaseReturn.grandTotal),
      }
    : null;

  const config: PurchaseDocumentEditorConfig<PurchaseReturnRow> = useMemo(
    () => ({
      title: t("purchasing.returns.editorTitle"),
      documentType: "PURCHASE_RETURN",
      permissions: {
        create: "purchasing.returns.create",
        edit: "purchasing.returns.edit",
        approve: "purchasing.returns.approve",
        cancel: "purchasing.returns.cancel",
        confirm: "purchasing.returns.confirm",
      },
      statusOptions: buildReturnStatusOptions(t),
      numbering: { documentType: "PURCHASE_RETURN", docCodePreview: "PR" },
      requireWarehouse: true,
      toolbarExtra: (
        <EnterpriseButton
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={
            isSaving || isTransitioning || (!!purchaseReturn && purchaseReturn.status !== "DRAFT")
          }
          onClick={handleSave}
        >
          <Save className="size-3.5" />
          {t("common.save")}
        </EnterpriseButton>
      ),
      workflowActions: [
        {
          key: "submit",
          label: t("purchasing.returns.actions.submit"),
          icon: Send,
          variant: "outline",
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition(
              (rid) => purchaseReturnsService.submit(rid),
              "purchasing.returns.toasts.submitted",
            ),
        },
        {
          key: "approve",
          label: t("purchasing.returns.actions.approve"),
          icon: CheckCircle2,
          variant: "outline",
          visibleForStatuses: ["PENDING_APPROVAL"],
          onAction: () =>
            runTransition(
              (rid) => purchaseReturnsService.approve(rid),
              "purchasing.returns.toasts.approved",
            ),
        },
        {
          key: "confirm",
          label: t("purchasing.returns.actions.confirm"),
          icon: PackageMinus,
          variant: "default",
          visibleForStatuses: ["APPROVED"],
          onAction: () =>
            runTransition(
              (rid) => purchaseReturnsService.confirm(rid),
              "purchasing.returns.toasts.confirmed",
            ),
        },
        {
          key: "cancel",
          label: t("purchasing.returns.actions.cancel"),
          icon: Ban,
          variant: "destructive",
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
          confirm: {
            title: t("purchasing.returns.confirmCancelTitle"),
            description: t("purchasing.returns.confirmCancelDescription"),
            confirmLabel: t("purchasing.returns.actions.cancel"),
            tone: "destructive",
          },
          onAction: async () => {
            await runTransition(
              (rid) => purchaseReturnsService.cancel(rid),
              "purchasing.returns.toasts.cancelled",
            );
          },
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
      purchaseReturn,
      supplier,
      currency,
      lines,
      documentDate,
      referenceNumber,
      notes,
      terms,
    ],
  );

  const state: PurchaseDocumentEditorState<PurchaseReturnRow> = {
    document: purchaseReturn,
    documentNumber: purchaseReturn?.returnNumber ?? null,
    status: purchaseReturn?.status ?? "DRAFT",
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

  const canEdit = !purchaseReturn || purchaseReturn.status === "DRAFT";
  const canApprove = hasPermission("purchasing.returns.approve");
  const canCancel = hasPermission("purchasing.returns.cancel");
  const canConfirm = hasPermission("purchasing.returns.confirm");

  useBreadcrumbLabel(purchaseReturn?.returnNumber ?? t("purchasing.returns.addNew"));

  return (
    <EditorWorkspace>
      <RelatedRecordsPanel kind="PURCHASE_RETURN" id={id} refreshKey={purchaseReturn?.status} />

      <PurchasingDocumentEditor
        config={{
          ...config,
          workflowActions: config.workflowActions.filter((action) => {
            if (action.key === "approve" && !canApprove) return false;
            if (action.key === "cancel" && !canCancel) return false;
            if (action.key === "confirm" && !canConfirm) return false;
            if (action.key === "print" && !purchaseReturn) return false;
            return true;
          }),
        }}
        state={state}
        handlers={handlers}
        activity={activity}
        isLoading={isLoading}
        disabled={!canEdit || isSaving}
        isBusy={isSaving || isTransitioning}
        fieldErrors={showValidation ? (validate() ?? undefined) : undefined}
      />
    </EditorWorkspace>
  );
}
