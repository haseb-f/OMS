"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, PackageCheck, Printer, Save, Send, Undo2, Wallet } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
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
  purchaseInvoicesService,
  type PurchaseInvoiceItemRow,
  type PurchaseInvoiceRow,
} from "@/services/purchase-invoices-service";
import type { SupplierRow } from "@/services/suppliers-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildInvoiceStatusOptions } from "@/config/purchasing/invoice-status";
import { RETURN_STATUS_LABEL_KEY, RETURN_STATUS_TONE } from "@/config/purchasing/return-status";
import {
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { RelatedDocuments } from "@/components/shared/related-documents";
import { useSourceJournalEntryLinks } from "@/hooks/use-source-journal-entry";
import { buildInvoicePrintPayload } from "@/config/purchasing/invoice-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { CreateReturnDialog } from "./create-return-dialog";
import { InvoicePaymentSummary } from "@/components/business/invoice-payment-summary";

function itemToLine(item: PurchaseInvoiceItemRow): ProductLineItemsGridLine {
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

/** Mirrors the Sales Invoice editor — "Confirm" here means Goods Receipt (increases inventory). */
export function InvoiceEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [invoice, setInvoice] = useState<PurchaseInvoiceRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<PurchaseDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [documentDate, setDocumentDate] = useState<Date | null>(new Date());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyInvoice = useCallback((data: PurchaseInvoiceRow) => {
    setInvoice(data);
    setSupplier(data.supplier ?? null);
    setCurrency(data.currency ?? null);
    setDocumentDate(new Date(data.createdAt));
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
        applyInvoice(await purchaseInvoicesService.get(id));
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Failed to load purchase invoice.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyInvoice]);

  const refreshActivity = useCallback((invoiceId: string) => {
    purchaseInvoicesService
      .activities(invoiceId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  const validate = (): string | null => {
    if (!supplier) return t("purchasing.invoices.validation.supplierRequired");
    if (realLines.length === 0) return t("purchasing.invoices.validation.productRequired");
    for (const line of realLines) {
      if (line.quantity <= 0) return t("purchasing.invoices.validation.quantityPositive");
      if (!line.warehouse) return t("sales.editor.grid.warehouseRequired");
    }
    return null;
  };

  const buildPayload = () => ({
    supplierId: supplier!.id,
    currencyId: currency?.id,
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
        const updated = await purchaseInvoicesService.update(id, buildPayload());
        applyInvoice(updated);
        toast.success(t("common.save"));
      } else {
        const created = await purchaseInvoicesService.create(buildPayload());
        toast.success(t("common.save"));
        router.replace(`/purchasing/purchase-invoices/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (invoiceId: string) => Promise<PurchaseInvoiceRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyInvoice(updated);
      toast.success(t(successKey));
      refreshActivity(id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!invoice) return;
    printDocument(
      buildInvoicePrintPayload(invoice, {
        companyName: activeCompany?.name ?? "",
        companyLogoUrl: activeCompany?.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  const totals: DocumentTotals | null = invoice
    ? {
        subtotal: Number(invoice.subtotal),
        discountTotal: Number(invoice.discountTotal),
        taxTotal: Number(invoice.taxTotal),
        grandTotal: Number(invoice.grandTotal),
      }
    : null;

  const config: PurchaseDocumentEditorConfig<PurchaseInvoiceRow> = useMemo(
    () => ({
      title: t("purchasing.invoices.editorTitle"),
      documentType: "PURCHASE_INVOICE",
      permissions: {
        create: "purchasing.invoices.create",
        edit: "purchasing.invoices.edit",
        approve: "purchasing.invoices.approve",
        cancel: "purchasing.invoices.cancel",
        confirm: "purchasing.invoices.confirm",
      },
      statusOptions: buildInvoiceStatusOptions(t),
      numbering: { documentType: "PURCHASE_INVOICE", docCodePreview: "PI" },
      requireWarehouse: true,
      toolbarExtra: (
        <EnterpriseButton
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={isSaving || isTransitioning || (!!invoice && invoice.status !== "DRAFT")}
          onClick={handleSave}
        >
          <Save className="size-3.5" />
          {t("common.save")}
        </EnterpriseButton>
      ),
      workflowActions: [
        {
          key: "submit",
          label: t("purchasing.invoices.actions.submit"),
          icon: Send,
          variant: "outline",
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition(
              (iid) => purchaseInvoicesService.submit(iid),
              "purchasing.invoices.toasts.submitted",
            ),
        },
        {
          key: "approve",
          label: t("purchasing.invoices.actions.approve"),
          icon: CheckCircle2,
          variant: "outline",
          visibleForStatuses: ["PENDING_APPROVAL"],
          onAction: () =>
            runTransition(
              (iid) => purchaseInvoicesService.approve(iid),
              "purchasing.invoices.toasts.approved",
            ),
        },
        {
          key: "confirm",
          label: t("purchasing.invoices.actions.confirm"),
          icon: PackageCheck,
          variant: "default",
          visibleForStatuses: ["APPROVED"],
          onAction: () =>
            runTransition(
              (iid) => purchaseInvoicesService.confirm(iid),
              "purchasing.invoices.toasts.confirmed",
            ),
        },
        {
          key: "cancel",
          label: t("purchasing.invoices.actions.cancel"),
          icon: Ban,
          variant: "destructive",
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
          onAction: () => setCancelTarget(true),
        },
        {
          key: "recordPayment",
          label: t("purchasing.invoices.actions.recordPayment"),
          icon: Wallet,
          variant: "outline",
          visibleForStatuses: ["CONFIRMED"],
          onAction: () =>
            router.push(
              `/purchasing/payments/new?supplierId=${invoice?.supplierId ?? supplier?.id}&invoiceId=${invoice?.id}`,
            ),
        },
        {
          key: "convert",
          label: t("purchasing.invoices.actions.createReturn"),
          icon: Undo2,
          variant: "outline",
          visibleForStatuses: ["CONFIRMED"],
          onAction: () => setReturnOpen(true),
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
      invoice,
      supplier,
      currency,
      lines,
      documentDate,
      referenceNumber,
      notes,
      terms,
      router,
    ],
  );

  const state: PurchaseDocumentEditorState<PurchaseInvoiceRow> = {
    document: invoice,
    documentNumber: invoice?.invoiceNumber ?? null,
    status: invoice?.status ?? "DRAFT",
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

  const canEdit = !invoice || invoice.status === "DRAFT";
  const canApprove = hasPermission("purchasing.invoices.approve");
  const canCancel = hasPermission("purchasing.invoices.cancel");
  const canConfirm = hasPermission("purchasing.invoices.confirm");
  const canRecordPayment = hasPermission("purchasing.payments.create");
  const journalEntryLinks = useSourceJournalEntryLinks("PURCHASE_INVOICE", invoice?.id);

  useBreadcrumbLabel(invoice?.invoiceNumber ?? t("purchasing.invoices.addNew"));

  return (
    <EditorWorkspace backHref="/purchasing/purchase-invoices">
      <RelatedDocuments
        groups={[
          {
            labelKey: "purchasing.invoices.fromOrder",
            links:
              invoice?.purchaseOrder && invoice.purchaseOrderId
                ? [
                    {
                      id: invoice.purchaseOrderId,
                      number: invoice.purchaseOrder.poNumber,
                      href: `/purchasing/purchase-orders/${invoice.purchaseOrderId}`,
                    },
                  ]
                : [],
          },
          {
            labelKey: "purchasing.invoices.relatedPayments",
            links: (invoice?.allocations ?? [])
              .filter((allocation) => allocation.transaction)
              .map((allocation) => ({
                id: allocation.transaction!.id,
                number: allocation.transaction!.transactionNumber,
                href: `/purchasing/payments/${allocation.transaction!.id}`,
                statusLabel: t(TRANSACTION_STATUS_LABEL_KEY[allocation.transaction!.status]),
                statusTone: TRANSACTION_STATUS_TONE[allocation.transaction!.status],
              })),
          },
          {
            labelKey: "purchasing.invoices.relatedReturns",
            links: (invoice?.returns ?? []).map((purchaseReturn) => ({
              id: purchaseReturn.id,
              number: purchaseReturn.returnNumber,
              href: `/purchasing/purchase-returns/${purchaseReturn.id}`,
              statusLabel: t(RETURN_STATUS_LABEL_KEY[purchaseReturn.status]),
              statusTone: RETURN_STATUS_TONE[purchaseReturn.status],
            })),
          },
          {
            labelKey: "purchasing.invoices.relatedJournalEntry",
            links: journalEntryLinks,
          },
        ]}
      />

      <PurchasingDocumentEditor
        config={{
          ...config,
          workflowActions: config.workflowActions.filter((action) => {
            if (action.key === "approve" && !canApprove) return false;
            if (action.key === "cancel" && !canCancel) return false;
            if (action.key === "confirm" && !canConfirm) return false;
            if (action.key === "recordPayment" && !canRecordPayment) return false;
            if (action.key === "print" && !invoice) return false;
            return true;
          }),
        }}
        state={state}
        handlers={handlers}
        activity={activity}
        isLoading={isLoading}
        disabled={!canEdit || isSaving}
        isBusy={isSaving || isTransitioning}
        paymentSummary={
          invoice && (
            <InvoicePaymentSummary
              paymentStatus={invoice.paymentStatus}
              grandTotal={Number(invoice.grandTotal)}
              allocatedTotal={invoice.allocatedTotal}
              remainingBalance={invoice.remainingBalance}
              currencyCode={invoice.currency?.code}
            />
          )
        }
      />

      <ConfirmationDialog
        open={cancelTarget}
        onOpenChange={setCancelTarget}
        tone="destructive"
        title={t("purchasing.invoices.confirmCancelTitle")}
        description={t("purchasing.invoices.confirmCancelDescription")}
        confirmLabel={t("purchasing.invoices.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelTarget(false);
          await runTransition(
            (iid) => purchaseInvoicesService.cancel(iid),
            "purchasing.invoices.toasts.cancelled",
          );
        }}
      />

      {invoice && (
        <CreateReturnDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          invoice={invoice}
          onCreated={(purchaseReturn) =>
            router.push(`/purchasing/purchase-returns/${purchaseReturn.id}`)
          }
        />
      )}
    </EditorWorkspace>
  );
}
