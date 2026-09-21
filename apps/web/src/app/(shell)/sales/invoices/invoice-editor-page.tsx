"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  PackageCheck,
  Printer,
  Save,
  Send,
  Undo2,
  Banknote,
} from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorWorkspace } from "@/components/shared/detail-workspace";
import {
  SalesDocumentEditor,
  createEmptyLine,
  type ProductLineItemsGridLine,
  type SalesDocumentEditorConfig,
  type SalesDocumentEditorHandlers,
  type SalesDocumentEditorState,
  type SalesDocumentActivityEntry,
} from "@/components/sales";
import type { DocumentTotals } from "@/components/sales";
import {
  salesInvoicesService,
  type SalesInvoiceItemRow,
  type SalesInvoiceRow,
} from "@/services/sales-invoices-service";
import type { PartnerRow } from "@/services/partners-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildInvoiceStatusOptions } from "@/config/sales/invoice-status";
import { buildInvoicePrintPayload } from "@/config/sales/invoice-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { toast } from "@/lib/toast";
import { useExchangeRateRecovery } from "@/hooks/use-exchange-rate-recovery";
import { lifecycleActions } from "@/config/documents/lifecycle-actions";
import { ApiError } from "@/services/api-client";
import { CreateReturnDialog } from "./create-return-dialog";
import { InvoicePaymentSummary } from "@/components/business/invoice-payment-summary";

function itemToLine(item: SalesInvoiceItemRow): ProductLineItemsGridLine {
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

export function InvoiceEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();
  const fx = useExchangeRateRecovery();

  const [invoice, setInvoice] = useState<SalesInvoiceRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<SalesDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

  const [customer, setCustomer] = useState<PartnerRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyInvoice = useCallback((data: SalesInvoiceRow) => {
    setInvoice(data);
    setCustomer(data.partner ?? null);
    setCurrency(data.currency ?? null);
    setReferenceNumber(data.referenceNumber ?? "");
    setNotes(data.internalNotes ?? "");
    setTerms(data.customerNotes ?? "");
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
        const data = await salesInvoicesService.get(id);
        applyInvoice(data);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Failed to load sales invoice.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyInvoice]);

  const refreshActivity = useCallback((invoiceId: string) => {
    salesInvoicesService
      .activities(invoiceId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  const validate = (): string | null => {
    if (!customer) return t("sales.invoices.validation.customerRequired");
    if (realLines.length === 0) return t("sales.invoices.validation.productRequired");
    for (const line of realLines) {
      if (line.quantity <= 0) return t("sales.invoices.validation.quantityPositive");
      if (!line.warehouse) return t("sales.editor.grid.warehouseRequired");
    }
    return null;
  };

  const buildPayload = () => ({
    partnerId: customer!.id,
    currencyId: currency?.id,
    referenceNumber: referenceNumber || undefined,
    internalNotes: notes || undefined,
    customerNotes: terms || undefined,
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
        const updated = await salesInvoicesService.update(id, buildPayload());
        applyInvoice(updated);
        toast.success(t("common.saved"));
      } else {
        const created = await salesInvoicesService.create(buildPayload());
        toast.success(t("common.saved"));
        router.replace(`/sales/invoices/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (invoiceId: string) => Promise<SalesInvoiceRow | null>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      if (!updated) return;
      // Transition responses are partial (no payment summary / related
      // documents); always re-read the full document before rendering it.
      applyInvoice(await salesInvoicesService.get(id));
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
    const payload = buildInvoicePrintPayload(invoice, {
      companyName: activeCompany?.name ?? "",
      companyLogoUrl: activeCompany?.logoUrl ?? null,
      printedByName: user?.fullName ?? null,
      t,
    });
    printDocument(payload);
  };

  const totals: DocumentTotals | null = invoice
    ? {
        subtotal: Number(invoice.subtotal),
        discountTotal: Number(invoice.discountTotal),
        taxTotal: Number(invoice.taxTotal),
        grandTotal: Number(invoice.grandTotal),
      }
    : null;

  const config: SalesDocumentEditorConfig<SalesInvoiceRow> = useMemo(
    () => ({
      title: t("sales.invoices.editorTitle"),
      documentType: "SALES_INVOICE",
      permissions: {
        create: "sales.invoices.create",
        edit: "sales.invoices.edit",
        approve: "sales.invoices.approve",
        cancel: "sales.invoices.cancel",
        confirm: "sales.invoices.confirm",
      },
      statusOptions: buildInvoiceStatusOptions(t),
      numbering: { documentType: "SALES_INVOICE", docCodePreview: "INV" },
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
      trace: { kind: "SALES_INVOICE", id },
      workflowActions: [
        {
          key: "submit",
          primary: true,
          label: t("sales.invoices.actions.submit"),
          icon: Send,
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition(
              (iid) => salesInvoicesService.submit(iid),
              "sales.invoices.toasts.submitted",
            ),
        },
        {
          key: "approve",
          primary: true,
          label: t("sales.invoices.actions.approve"),
          icon: CheckCircle2,
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL"],
          onAction: () =>
            runTransition(
              (iid) => salesInvoicesService.approve(iid),
              "sales.invoices.toasts.approved",
            ),
        },
        {
          key: "confirm",
          primary: true,
          label: t("sales.invoices.actions.confirm"),
          icon: PackageCheck,
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
          confirm: {
            title: t("docFlow.flow.salesInvoiceTitle"),
            description: t("docFlow.flow.salesInvoiceDescription"),
          },
          onAction: () =>
            runTransition(
              (iid) =>
                fx.run(() => salesInvoicesService.confirm(iid), {
                  currencyId: currency?.id ?? null,
                }),
              "sales.invoices.toasts.confirmed",
            ),
        },
        {
          key: "receivePayment",
          primary: true,
          label: t("sales.invoices.actions.receivePayment"),
          icon: Banknote,
          visibleForStatuses: ["CONFIRMED"],
          onAction: () =>
            router.push(
              `/sales/payments/new?partnerId=${invoice?.partnerId ?? customer?.id}&invoiceId=${invoice?.id}`,
            ),
        },
        {
          key: "convert",
          label: t("sales.invoices.actions.createReturn"),
          icon: Undo2,
          visibleForStatuses: ["CONFIRMED"],
          onAction: () => setReturnOpen(true),
        },
        {
          // A Confirmed invoice is never cancelled directly — reversed only via a Sales Return, the action just above.
          key: "cancel",
          label: t("sales.invoices.actions.cancel"),
          icon: Ban,
          destructive: true,
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
          onAction: () => setCancelTarget(true),
        },
        {
          key: "print",
          label: t("table.print"),
          icon: Printer,
          onAction: () => handlePrint(),
        },
        ...lifecycleActions({
          t,
          documentLabel: invoice?.invoiceNumber ?? "",
          canCreate: hasPermission("sales.invoices.create"),
          canEdit: hasPermission("sales.invoices.edit"),
          returnToDraftStatuses: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
          onDuplicate: async () => {
            if (!id) return;
            try {
              const copy = await salesInvoicesService.duplicate(id);
              toast.success(t("docFlow.lifecycle.duplicated", { number: copy.invoiceNumber }));
              router.push(`/sales/invoices/${copy.id}`);
            } catch (error) {
              toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
            }
          },
          onReturnToDraft: () =>
            runTransition(
              (docId) => salesInvoicesService.returnToDraft(docId),
              "docFlow.lifecycle.returnedToDraft",
            ),
        }),
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      isSaving,
      isTransitioning,
      invoice,
      customer,
      currency,
      lines,
      referenceNumber,
      notes,
      terms,
      router,
      id,
    ],
  );

  const state: SalesDocumentEditorState<SalesInvoiceRow> = {
    document: invoice,
    documentNumber: invoice?.invoiceNumber ?? null,
    status: invoice?.status ?? "DRAFT",
    documentDate: invoice ? new Date(invoice.createdAt) : new Date(),
    salespersonId: null,
    customer,
    currency,
    referenceNumber,
    notes,
    terms,
    lines,
    totals,
  };

  const handlers: SalesDocumentEditorHandlers = {
    // Sales Invoice has no editable date column server-side — the date shown is createdAt.
    onDocumentDateChange: () => undefined,
    onSalespersonChange: () => undefined,
    onCustomerChange: setCustomer,
    onCurrencyChange: setCurrency,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onTermsChange: setTerms,
    onLinesChange: setLines,
  };

  const canEdit = !invoice || invoice.status === "DRAFT";
  const canApprove = hasPermission("sales.invoices.approve");
  const canConfirm = hasPermission("sales.invoices.confirm");
  const canCancel = hasPermission("sales.invoices.cancel");
  const canReceivePayment = hasPermission("sales.receipts.create");

  useBreadcrumbLabel(invoice?.invoiceNumber ?? t("sales.invoices.addNew"));

  return (
    <EditorWorkspace>
      <SalesDocumentEditor
        config={{
          ...config,
          workflowActions: config.workflowActions
            .map((action) =>
              action.key === "confirm" && !canApprove
                ? { ...action, visibleForStatuses: ["APPROVED"] }
                : action,
            )
            .filter((action) => {
              if (action.key === "submit" && canApprove) return false;
              if (action.key === "approve" && canConfirm) return false;
              if (action.key === "approve" && !canApprove) return false;
              if (action.key === "confirm" && !canConfirm) return false;
              if (action.key === "cancel" && !canCancel) return false;
              if (
                action.key === "receivePayment" &&
                (!canReceivePayment || invoice?.paymentStatus === "PAID")
              )
                return false;
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
        title={t("sales.invoices.confirmCancelTitle")}
        description={t("sales.invoices.confirmCancelDescription")}
        confirmLabel={t("sales.invoices.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelTarget(false);
          await runTransition(
            (iid) => salesInvoicesService.cancel(iid),
            "sales.invoices.toasts.cancelled",
          );
        }}
      />

      {invoice && (
        <CreateReturnDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          invoice={invoice}
          onCreated={(salesReturn) => router.push(`/sales/returns/${salesReturn.id}`)}
        />
      )}
      {fx.dialog}
    </EditorWorkspace>
  );
}
