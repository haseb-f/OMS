"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle, Ban, CheckCircle2, Lock, Printer, Save } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorWorkspace } from "@/components/shared/detail-workspace";
import { PurchasingDocumentEditor } from "@/components/purchasing/purchasing-document-editor";
import {
  createEmptyLine,
  type ProductLineItemsGridLine,
} from "@/components/sales/product-line-items-grid";
import {
  previewSalesLine,
  previewSalesDocumentTotals,
} from "@/components/sales/sales-line-preview-math";
import { useTaxes } from "@/hooks/use-reference-data";
import type { CurrencyRow } from "@/config/master-data/entities";
import type { DocumentTotals } from "@/components/sales/document-totals-footer";
import type {
  PurchaseDocumentEditorConfig,
  PurchaseDocumentEditorHandlers,
  PurchaseDocumentEditorState,
  PurchaseDocumentActivityEntry,
} from "@/components/purchasing/purchasing-document-editor.types";
import {
  purchaseOrdersService,
  type PurchaseOrderItemRow,
  type PurchaseOrderRow,
} from "@/services/purchase-orders-service";
import type { SupplierRow } from "@/services/suppliers-service";
import { buildOrderStatusOptions } from "@/config/purchasing/order-status";
import { INVOICE_STATUS_LABEL_KEY, INVOICE_STATUS_TONE } from "@/config/purchasing/invoice-status";
import { RelatedDocuments } from "@/components/shared/related-documents";
import { buildOrderPrintPayload } from "@/config/purchasing/order-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { ConvertToInvoiceDialog } from "./convert-to-invoice-dialog";

function itemToLine(item: PurchaseOrderItemRow): ProductLineItemsGridLine {
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

/**
 * Mirrors `sales/orders` but for Purchase Order's own simpler Phase-1
 * lifecycle (ADR-0015: Draft -> Approved -> Closed, Cancel from Draft/
 * Approved) — no Submit/Confirm step, no per-line Warehouse. PurchaseOrder
 * stores no aggregate totals (only caller-supplied `item.subtotal`), so the
 * footer total is a live client computation over the same shared preview
 * math every grid already uses (`previewSalesLine`) — not a fabricated
 * number, the exact figure that becomes each line's persisted `subtotal`.
 * Editable while Draft, same as every other Purchasing document.
 */
export function OrderEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [order, setOrder] = useState<PurchaseOrderRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<PurchaseDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState(false);
  const [closeTarget, setCloseTarget] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);
  const taxes = useTaxes();

  const taxRateById = useMemo(
    () => new Map(taxes.map((tax) => [tax.id, Number(tax.rate)])),
    [taxes],
  );

  const applyOrder = useCallback((data: PurchaseOrderRow) => {
    setOrder(data);
    setSupplier(data.supplier ?? null);
    setCurrency(data.currency ?? null);
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
        applyOrder(await purchaseOrdersService.get(id));
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Failed to load purchase order.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyOrder]);

  const refreshActivity = useCallback((orderId: string) => {
    purchaseOrdersService
      .activities(orderId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  const validate = (): string | null => {
    if (!supplier) return t("purchasing.orders.validation.supplierRequired");
    if (realLines.length === 0) return t("purchasing.orders.validation.productRequired");
    for (const line of realLines) {
      if (line.quantity <= 0) return t("purchasing.orders.validation.quantityPositive");
    }
    return null;
  };

  const buildPayload = () => ({
    supplierId: supplier!.id,
    currencyId: currency?.id,
    purchaseType: "INVENTORY" as const,
    referenceNumber: referenceNumber || undefined,
    internalNotes: notes || undefined,
    supplierNotes: terms || undefined,
    items: realLines.map((line) => {
      const preview = previewSalesLine({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
      });
      return {
        productId: line.product!.id,
        description: line.description || undefined,
        unitId: line.unitId ?? line.product!.unitId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        subtotal: preview.lineTotal,
        taxId: line.taxId ?? undefined,
      };
    }),
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
        const updated = await purchaseOrdersService.update(id, buildPayload());
        applyOrder(updated);
        toast.success(t("common.save"));
      } else {
        const created = await purchaseOrdersService.create(buildPayload());
        toast.success(t("common.save"));
        router.replace(`/purchasing/purchase-orders/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (orderId: string) => Promise<PurchaseOrderRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyOrder(updated);
      toast.success(t(successKey));
      refreshActivity(id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!order) return;
    printDocument(
      buildOrderPrintPayload(order, {
        companyName: activeCompany?.name ?? "",
        companyLogoUrl: activeCompany?.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  const totals: DocumentTotals = useMemo(
    () =>
      previewSalesDocumentTotals(
        realLines.map((line) =>
          previewSalesLine({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            taxRatePercent: line.taxId ? taxRateById.get(line.taxId) : undefined,
          }),
        ),
      ),
    [realLines, taxRateById],
  );

  const config: PurchaseDocumentEditorConfig<PurchaseOrderRow> = useMemo(
    () => ({
      title: t("purchasing.orders.editorTitle"),
      documentType: "PURCHASE_ORDER",
      permissions: {
        create: "purchasing.orders.create",
        edit: "purchasing.orders.edit",
        approve: "purchasing.orders.approve",
        cancel: "purchasing.orders.cancel",
      },
      statusOptions: buildOrderStatusOptions(t),
      numbering: { documentType: "PURCHASE_ORDER", docCodePreview: "PO" },
      requireWarehouse: false,
      toolbarExtra:
        !order || order.status === "DRAFT" ? (
          <EnterpriseButton
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={isSaving}
            onClick={handleSave}
          >
            <Save className="size-3.5" />
            {t("common.save")}
          </EnterpriseButton>
        ) : undefined,
      workflowActions: [
        {
          key: "approve",
          label: t("purchasing.orders.actions.approve"),
          icon: CheckCircle2,
          variant: "outline",
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition(
              (oid) => purchaseOrdersService.approve(oid),
              "purchasing.orders.toasts.approved",
            ),
        },
        {
          key: "convert",
          label: t("purchasing.orders.actions.convertToInvoice"),
          icon: ArrowRightCircle,
          variant: "outline",
          visibleForStatuses: ["APPROVED"],
          onAction: () => setConvertOpen(true),
        },
        {
          key: "cancel",
          label: t("purchasing.orders.actions.cancel"),
          icon: Ban,
          variant: "destructive",
          visibleForStatuses: ["DRAFT", "APPROVED"],
          onAction: () => setCancelTarget(true),
        },
        {
          key: "reject",
          label: t("common.close"),
          icon: Lock,
          variant: "outline",
          visibleForStatuses: ["APPROVED"],
          onAction: () => setCloseTarget(true),
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
      id,
      isSaving,
      isTransitioning,
      order,
      supplier,
      currency,
      lines,
      referenceNumber,
      notes,
      terms,
    ],
  );

  const state: PurchaseDocumentEditorState<PurchaseOrderRow> = {
    document: order,
    documentNumber: order?.poNumber ?? null,
    status: order?.status ?? "DRAFT",
    documentDate: order ? new Date(order.createdAt) : new Date(),
    supplier,
    currency,
    referenceNumber,
    notes,
    terms,
    lines,
    totals,
  };

  const handlers: PurchaseDocumentEditorHandlers = {
    // No `documentDate` column exists on PurchaseOrder (ADR-0015) — display-only.
    onDocumentDateChange: () => undefined,
    onSupplierChange: setSupplier,
    onCurrencyChange: setCurrency,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onTermsChange: setTerms,
    onLinesChange: setLines,
  };

  const canEdit = !order || order.status === "DRAFT";
  const canApprove = hasPermission("purchasing.orders.approve");
  const canCancel = hasPermission("purchasing.orders.cancel");

  useBreadcrumbLabel(order?.poNumber ?? t("purchasing.orders.addNew"));

  return (
    <EditorWorkspace>
      <RelatedDocuments
        groups={[
          {
            labelKey: "purchasing.orders.fromQuotation",
            links:
              order?.quotation && order.quotationId
                ? [
                    {
                      id: order.quotationId,
                      number: order.quotation.quotationNumber,
                      href: `/purchasing/purchase-quotations/${order.quotationId}`,
                    },
                  ]
                : [],
          },
          {
            labelKey: "purchasing.orders.relatedInvoices",
            links: (order?.invoices ?? []).map((invoice) => ({
              id: invoice.id,
              number: invoice.invoiceNumber,
              href: `/purchasing/purchase-invoices/${invoice.id}`,
              statusLabel: t(INVOICE_STATUS_LABEL_KEY[invoice.status]),
              statusTone: INVOICE_STATUS_TONE[invoice.status],
            })),
          },
        ]}
      />

      <PurchasingDocumentEditor
        config={{
          ...config,
          workflowActions: config.workflowActions.filter((action) => {
            if (action.key === "approve" && !canApprove) return false;
            if (action.key === "cancel" && !canCancel) return false;
            if (action.key === "reject" && !canApprove) return false;
            if (action.key === "print" && !order) return false;
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
        title={t("purchasing.orders.confirmCancelTitle")}
        description={t("purchasing.orders.confirmCancelDescription")}
        confirmLabel={t("purchasing.orders.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelTarget(false);
          await runTransition(
            (oid) => purchaseOrdersService.cancel(oid),
            "purchasing.orders.toasts.cancelled",
          );
        }}
      />

      <ConfirmationDialog
        open={closeTarget}
        onOpenChange={setCloseTarget}
        title={t("common.close")}
        description={t("purchasing.orders.confirmCancelDescription")}
        confirmLabel={t("common.close")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCloseTarget(false);
          await runTransition(
            (oid) => purchaseOrdersService.close(oid),
            "purchasing.orders.toasts.approved",
          );
        }}
      />

      {order && (
        <ConvertToInvoiceDialog
          open={convertOpen}
          onOpenChange={setConvertOpen}
          order={order}
          onConverted={(invoice) => router.push(`/purchasing/purchase-invoices/${invoice.id}`)}
        />
      )}
    </EditorWorkspace>
  );
}
