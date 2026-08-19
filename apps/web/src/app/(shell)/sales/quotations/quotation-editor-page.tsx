"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle, Ban, CheckCircle2, Printer, Save, Send } from "lucide-react";
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
  salesQuotationsService,
  type SalesQuotationItemRow,
  type SalesQuotationRow,
} from "@/services/sales-quotations-service";
import type { CustomerRow } from "@/services/customers-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildQuotationStatusOptions } from "@/config/sales/quotation-status";
import { buildQuotationPrintPayload } from "@/config/sales/quotation-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { ConvertToOrderDialog } from "./convert-to-order-dialog";

function itemToLine(item: SalesQuotationItemRow): ProductLineItemsGridLine {
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

export function QuotationEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [quotation, setQuotation] = useState<SalesQuotationRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<SalesDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [documentDate, setDocumentDate] = useState<Date | null>(new Date());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyQuotation = useCallback((data: SalesQuotationRow) => {
    setQuotation(data);
    setCustomer(data.customer ?? null);
    setCurrency(data.currency ?? null);
    setDocumentDate(new Date(data.documentDate));
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
        const data = await salesQuotationsService.get(id);
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
    salesQuotationsService
      .activities(quotationId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  /** "No empty customer / No empty product / Quantity > 0 / Warehouse required" — client-side, per TASK-040. Server re-validates all of it independently. */
  const validate = (): string | null => {
    if (!customer) return t("sales.quotations.validation.customerRequired");
    if (realLines.length === 0) return t("sales.quotations.validation.productRequired");
    for (const line of realLines) {
      if (line.quantity <= 0) return t("sales.quotations.validation.quantityPositive");
      if (!line.warehouse) return t("sales.editor.grid.warehouseRequired");
    }
    return null;
  };

  const buildPayload = () => ({
    customerId: customer!.id,
    currencyId: currency?.id,
    documentDate: documentDate ? documentDate.toISOString() : undefined,
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
        const updated = await salesQuotationsService.update(id, buildPayload());
        applyQuotation(updated);
        toast.success(t("common.save"));
      } else {
        const created = await salesQuotationsService.create(buildPayload());
        toast.success(t("common.save"));
        router.replace(`/sales/quotations/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (quotationId: string) => Promise<SalesQuotationRow>,
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

  const config: SalesDocumentEditorConfig<SalesQuotationRow> = useMemo(
    () => ({
      title: t("sales.quotations.editorTitle"),
      documentType: "QUOTATION",
      permissions: {
        create: "sales.quotations.create",
        edit: "sales.quotations.edit",
        approve: "sales.quotations.approve",
        cancel: "sales.quotations.cancel",
      },
      statusOptions: buildQuotationStatusOptions(t),
      numbering: { documentType: "QUOTATION", docCodePreview: "QT" },
      requireWarehouse: true,
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
          label: t("sales.quotations.actions.submit"),
          icon: Send,
          variant: "outline",
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition(
              (qid) => salesQuotationsService.submit(qid),
              "sales.quotations.toasts.submitted",
            ),
        },
        {
          key: "approve",
          label: t("sales.quotations.actions.approve"),
          icon: CheckCircle2,
          variant: "outline",
          visibleForStatuses: ["PENDING_APPROVAL"],
          onAction: () =>
            runTransition(
              (qid) => salesQuotationsService.approve(qid),
              "sales.quotations.toasts.approved",
            ),
        },
        {
          key: "convert",
          label: t("sales.quotations.actions.convertToOrder"),
          icon: ArrowRightCircle,
          variant: "outline",
          visibleForStatuses: ["APPROVED"],
          onAction: () => setConvertOpen(true),
        },
        {
          key: "cancel",
          label: t("sales.quotations.actions.cancel"),
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
      customer,
      currency,
      lines,
      documentDate,
      referenceNumber,
      notes,
      terms,
    ],
  );

  const state: SalesDocumentEditorState<SalesQuotationRow> = {
    document: quotation,
    documentNumber: quotation?.quotationNumber ?? null,
    status: quotation?.status ?? "DRAFT",
    documentDate,
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
    onDocumentDateChange: setDocumentDate,
    onSalespersonChange: () => undefined,
    onCustomerChange: setCustomer,
    onCurrencyChange: setCurrency,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onTermsChange: setTerms,
    onLinesChange: setLines,
  };

  const canEdit = !quotation || quotation.status === "DRAFT";
  const canApprove = hasPermission("sales.quotations.approve");
  const canCancel = hasPermission("sales.quotations.cancel");

  useBreadcrumbLabel(quotation?.quotationNumber ?? t("sales.quotations.addNew"));

  return (
    <EditorWorkspace backHref="/sales/quotations">
      <SalesDocumentEditor
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
        title={t("sales.quotations.confirmCancelTitle")}
        description={t("sales.quotations.confirmCancelDescription")}
        confirmLabel={t("sales.quotations.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelTarget(false);
          await runTransition(
            (qid) => salesQuotationsService.cancel(qid),
            "sales.quotations.toasts.cancelled",
          );
        }}
      />

      {quotation && (
        <ConvertToOrderDialog
          open={convertOpen}
          onOpenChange={setConvertOpen}
          quotation={quotation}
          onConverted={(order) => router.push(`/sales/orders/${order.id}`)}
        />
      )}
    </EditorWorkspace>
  );
}
