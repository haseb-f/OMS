"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, PackagePlus, Printer, Save, Send } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorWorkspace } from "@/components/shared/detail-workspace";
import { RelatedDocuments } from "@/components/shared/related-documents";
import { useSourceJournalEntryLinks } from "@/hooks/use-source-journal-entry";
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
  salesReturnsService,
  type SalesReturnItemRow,
  type SalesReturnRow,
} from "@/services/sales-returns-service";
import type { CustomerRow } from "@/services/customers-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildReturnStatusOptions } from "@/config/sales/return-status";
import { buildReturnPrintPayload } from "@/config/sales/return-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

function itemToLine(item: SalesReturnItemRow): ProductLineItemsGridLine {
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
 * TASK-048 — a Sales Return is never created blank here; the only creation
 * path is the "Create Return" dialog on an open Sales Invoice. This page
 * only ever edits an existing (already invoice-linked) Draft return, so
 * `id` is always a real return id, never null.
 */
export function ReturnEditorPage({ id }: { id: string }) {
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [salesReturn, setSalesReturn] = useState<SalesReturnRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<SalesDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState(false);

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyReturn = useCallback((data: SalesReturnRow) => {
    setSalesReturn(data);
    setCustomer(data.customer ?? null);
    setCurrency(data.currency ?? null);
    setReferenceNumber(data.referenceNumber ?? "");
    setNotes(data.internalNotes ?? "");
    setTerms(data.customerNotes ?? "");
    setLines(data.items.length > 0 ? data.items.map(itemToLine) : [createEmptyLine()]);
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await salesReturnsService.get(id);
        applyReturn(data);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Failed to load sales return.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyReturn]);

  const refreshActivity = useCallback((returnId: string) => {
    salesReturnsService
      .activities(returnId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  const validate = (): string | null => {
    if (!customer) return t("sales.returns.validation.customerRequired");
    if (realLines.length === 0) return t("sales.returns.validation.productRequired");
    for (const line of realLines) {
      if (line.quantity <= 0) return t("sales.returns.validation.quantityPositive");
      if (!line.warehouse) return t("sales.editor.grid.warehouseRequired");
    }
    return null;
  };

  const buildPayload = () => ({
    customerId: customer!.id,
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
      const updated = await salesReturnsService.update(id, buildPayload());
      applyReturn(updated);
      toast.success(t("common.save"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (returnId: string) => Promise<SalesReturnRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyReturn(updated);
      toast.success(t(successKey));
      refreshActivity(id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!salesReturn) return;
    const payload = buildReturnPrintPayload(salesReturn, {
      companyName: activeCompany?.name ?? "",
      companyLogoUrl: activeCompany?.logoUrl ?? null,
      printedByName: user?.fullName ?? null,
      t,
    });
    printDocument(payload);
  };

  const totals: DocumentTotals | null = salesReturn
    ? {
        subtotal: Number(salesReturn.subtotal),
        discountTotal: Number(salesReturn.discountTotal),
        taxTotal: Number(salesReturn.taxTotal),
        grandTotal: Number(salesReturn.grandTotal),
      }
    : null;

  const config: SalesDocumentEditorConfig<SalesReturnRow> = useMemo(
    () => ({
      title: t("sales.returns.editorTitle"),
      documentType: "SALES_RETURN",
      permissions: {
        create: "sales.returns.create",
        edit: "sales.returns.edit",
        approve: "sales.returns.approve",
        cancel: "sales.returns.cancel",
        confirm: "sales.returns.confirm",
      },
      statusOptions: buildReturnStatusOptions(t),
      numbering: { documentType: "SALES_RETURN", docCodePreview: "SR" },
      requireWarehouse: true,
      toolbarExtra: (
        <EnterpriseButton
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={
            isSaving || isTransitioning || (!!salesReturn && salesReturn.status !== "DRAFT")
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
          label: t("sales.returns.actions.submit"),
          icon: Send,
          variant: "outline",
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition(
              (rid) => salesReturnsService.submit(rid),
              "sales.returns.toasts.submitted",
            ),
        },
        {
          key: "approve",
          label: t("sales.returns.actions.approve"),
          icon: CheckCircle2,
          variant: "outline",
          visibleForStatuses: ["PENDING_APPROVAL"],
          onAction: () =>
            runTransition(
              (rid) => salesReturnsService.approve(rid),
              "sales.returns.toasts.approved",
            ),
        },
        {
          key: "confirm",
          label: t("sales.returns.actions.confirm"),
          icon: PackagePlus,
          variant: "outline",
          visibleForStatuses: ["APPROVED"],
          onAction: () =>
            runTransition(
              (rid) => salesReturnsService.confirm(rid),
              "sales.returns.toasts.confirmed",
            ),
        },
        {
          key: "cancel",
          label: t("sales.returns.actions.cancel"),
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
      salesReturn,
      customer,
      currency,
      lines,
      referenceNumber,
      notes,
      terms,
    ],
  );

  const state: SalesDocumentEditorState<SalesReturnRow> = {
    document: salesReturn,
    documentNumber: salesReturn?.returnNumber ?? null,
    status: salesReturn?.status ?? "DRAFT",
    documentDate: salesReturn ? new Date(salesReturn.createdAt) : new Date(),
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
    // Sales Return has no editable date column server-side — the date shown is createdAt.
    onDocumentDateChange: () => undefined,
    onSalespersonChange: () => undefined,
    onCustomerChange: setCustomer,
    onCurrencyChange: setCurrency,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onTermsChange: setTerms,
    onLinesChange: setLines,
  };

  const canEdit = !salesReturn || salesReturn.status === "DRAFT";
  const canApprove = hasPermission("sales.returns.approve");
  const canConfirm = hasPermission("sales.returns.confirm");
  const canCancel = hasPermission("sales.returns.cancel");
  const journalEntryLinks = useSourceJournalEntryLinks("SALES_RETURN", salesReturn?.id);

  useBreadcrumbLabel(salesReturn?.returnNumber ?? t("sales.returns.addNew"));

  return (
    <EditorWorkspace backHref="/sales/returns">
      <RelatedDocuments
        groups={[
          {
            labelKey: "sales.returns.fromInvoice",
            links:
              salesReturn?.salesInvoice && salesReturn.salesInvoiceId
                ? [
                    {
                      id: salesReturn.salesInvoiceId,
                      number: salesReturn.salesInvoice.invoiceNumber,
                      href: `/sales/invoices/${salesReturn.salesInvoiceId}`,
                    },
                  ]
                : [],
          },
          {
            labelKey: "sales.returns.relatedJournalEntry",
            links: journalEntryLinks,
          },
        ]}
      />

      <SalesDocumentEditor
        config={{
          ...config,
          workflowActions: config.workflowActions.filter((action) => {
            if (action.key === "approve" && !canApprove) return false;
            if (action.key === "confirm" && !canConfirm) return false;
            if (action.key === "cancel" && !canCancel) return false;
            if (action.key === "print" && !salesReturn) return false;
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
        title={t("sales.returns.confirmCancelTitle")}
        description={t("sales.returns.confirmCancelDescription")}
        confirmLabel={t("sales.returns.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelTarget(false);
          await runTransition(
            (rid) => salesReturnsService.cancel(rid),
            "sales.returns.toasts.cancelled",
          );
        }}
      />
    </EditorWorkspace>
  );
}
