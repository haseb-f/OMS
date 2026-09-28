"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle, Ban, CheckCircle2, Printer, Save, Send } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
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
import type { PartnerPickerRow } from "@/services/partners-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildQuotationStatusOptions } from "@/config/sales/quotation-status";
import { buildQuotationPrintPayload } from "@/config/sales/quotation-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePrintCompany } from "@/components/print/print-brand";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { reportApiError, toast, reportSuccess } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { ConvertToOrderDialog } from "./convert-to-order-dialog";
import { lifecycleActions } from "@/config/documents/lifecycle-actions";
import type { CommercialDocumentFieldErrors } from "@/components/documents/commercial-document-editor";

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
  const printCompany = usePrintCompany();
  const { user, hasPermission } = useUserContext();

  const [quotation, setQuotation] = useState<SalesQuotationRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<SalesDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [convertOpen, setConvertOpen] = useState(false);

  const [customer, setCustomer] = useState<PartnerPickerRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [documentDate, setDocumentDate] = useState<Date | null>(new Date());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyQuotation = useCallback((data: SalesQuotationRow) => {
    setQuotation(data);
    setCustomer(data.partner ?? null);
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
        reportApiError(error, "errors.loadFailed");
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

  const canApprove = hasPermission("sales.quotations.approve");
  const realLines = lines.filter((line) => line.product !== null);

  /** "No empty customer / No empty product / Quantity > 0 / Warehouse required" — client-side, per TASK-040. Server re-validates all of it independently. */
  /** Shown inline under the fields after the first save attempt; entered data is never cleared. */
  const [showValidation, setShowValidation] = useState(false);
  const validate = (): CommercialDocumentFieldErrors | null => {
    if (!customer) return { party: t("sales.quotations.validation.customerRequired") };
    if (realLines.length === 0) return { lines: t("sales.quotations.validation.productRequired") };
    for (const line of realLines) {
      if (line.quantity <= 0) return { lines: t("sales.quotations.validation.quantityPositive") };
      if (!line.warehouse) return { lines: t("sales.editor.grid.warehouseRequired") };
    }
    return null;
  };

  const buildPayload = () => ({
    partnerId: customer!.id,
    currencyId: currency?.id,
    documentDate: documentDate ? documentDate.toISOString() : undefined,
    referenceNumber: referenceNumber || undefined,
    internalNotes: notes || undefined,
    customerNotes: terms || undefined,
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
      if (id) {
        const updated = await salesQuotationsService.update(id, buildPayload());
        applyQuotation(updated);
        reportSuccess(t("common.saved"));
      } else {
        const created = await salesQuotationsService.create(buildPayload());
        reportSuccess(t("common.saved"));
        router.replace(`/sales/quotations/${created.id}`);
      }
    } catch (error) {
      reportApiError(error, "errors.generic");
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
      if (!updated) return;
      // Transition responses are partial (no payment summary / related
      // documents); always re-read the full document before rendering it.
      applyQuotation(await salesQuotationsService.get(id));
      reportSuccess(t(successKey));
      refreshActivity(id);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!quotation) return;
    const payload = buildQuotationPrintPayload(quotation, {
      companyName: printCompany.name,
      companyLogoUrl: printCompany.logoUrl ?? null,
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
      trace: { kind: "SALES_QUOTATION", id },
      workflowActions: [
        canApprove
          ? {
              key: "approve",
              label: t("sales.quotations.actions.approve"),
              icon: CheckCircle2,
              primary: true,
              visibleForStatuses: ["DRAFT", "PENDING_APPROVAL"],
              confirm: {
                title: t("docFlow.flow.quotationApproveTitle"),
                description: t("docFlow.flow.quotationApproveDescription"),
              },
              onAction: () =>
                runTransition(
                  (qid) => salesQuotationsService.approve(qid),
                  "sales.quotations.toasts.approved",
                ),
            }
          : {
              key: "submit",
              label: t("sales.quotations.actions.submit"),
              icon: Send,
              primary: true,
              visibleForStatuses: ["DRAFT"],
              onAction: () =>
                runTransition(
                  (qid) => salesQuotationsService.submit(qid),
                  "sales.quotations.toasts.submitted",
                ),
            },
        {
          key: "convert",
          label: t("sales.quotations.actions.convertToOrder"),
          icon: ArrowRightCircle,
          primary: true,
          visibleForStatuses: ["APPROVED"],
          onAction: () => setConvertOpen(true),
        },
        {
          key: "print",
          label: t("table.print"),
          icon: Printer,
          onAction: () => handlePrint(),
        },
        ...lifecycleActions({
          t,
          documentLabel: quotation?.quotationNumber ?? "",
          canCreate: hasPermission("sales.quotations.create"),
          canEdit: hasPermission("sales.quotations.edit"),
          returnToDraftStatuses: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
          onDuplicate: async () => {
            if (!id) return;
            try {
              const copy = await salesQuotationsService.duplicate(id);
              reportSuccess(t("docFlow.lifecycle.duplicated", { number: copy.quotationNumber }));
              router.push(`/sales/quotations/${copy.id}`);
            } catch (error) {
              toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
            }
          },
          onReturnToDraft: () =>
            runTransition(
              (qid) => salesQuotationsService.returnToDraft(qid),
              "docFlow.lifecycle.returnedToDraft",
            ),
        }),
        {
          key: "cancel",
          label: t("sales.quotations.actions.cancel"),
          icon: Ban,
          destructive: true,
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
          confirm: {
            title: t("sales.quotations.confirmCancelTitle"),
            description: t("sales.quotations.confirmCancelDescription"),
          },
          onAction: () =>
            runTransition(
              (qid) => salesQuotationsService.cancel(qid),
              "sales.quotations.toasts.cancelled",
            ),
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
      id,
      canApprove,
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

  useBreadcrumbLabel(quotation?.quotationNumber ?? t("sales.quotations.addNew"));

  return (
    <EditorWorkspace>
      <SalesDocumentEditor
        config={config}
        state={state}
        handlers={handlers}
        activity={activity}
        isLoading={isLoading}
        disabled={!canEdit || isSaving}
        isBusy={isSaving || isTransitioning}
        fieldErrors={showValidation ? (validate() ?? undefined) : undefined}
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
