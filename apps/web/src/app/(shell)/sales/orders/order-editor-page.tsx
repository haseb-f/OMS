"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightCircle,
  Ban,
  CheckCircle2,
  PackageCheck,
  Printer,
  Save,
  Send,
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
  salesOrdersService,
  type SalesOrderItemRow,
  type SalesOrderRow,
} from "@/services/sales-orders-service";
import type { PartnerRow } from "@/services/partners-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { buildOrderStatusOptions } from "@/config/sales/order-status";
import { buildOrderPrintPayload } from "@/config/sales/order-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { toast } from "@/lib/toast";
import { lifecycleActions } from "@/config/documents/lifecycle-actions";
import { ApiError } from "@/services/api-client";
import { ConvertToInvoiceDialog } from "./convert-to-invoice-dialog";

function itemToLine(item: SalesOrderItemRow): ProductLineItemsGridLine {
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

export function OrderEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [order, setOrder] = useState<SalesOrderRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<SalesDocumentActivityEntry[] | null | undefined>(
    undefined,
  );
  const [cancelTarget, setCancelTarget] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const [customer, setCustomer] = useState<PartnerRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);

  const applyOrder = useCallback((data: SalesOrderRow) => {
    setOrder(data);
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
        const data = await salesOrdersService.get(id);
        applyOrder(data);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Failed to load sales order.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyOrder]);

  const refreshActivity = useCallback((orderId: string) => {
    salesOrdersService
      .activities(orderId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const realLines = lines.filter((line) => line.product !== null);

  const validate = (): string | null => {
    if (!customer) return t("sales.orders.validation.customerRequired");
    if (realLines.length === 0) return t("sales.orders.validation.productRequired");
    for (const line of realLines) {
      if (line.quantity <= 0) return t("sales.orders.validation.quantityPositive");
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
        const updated = await salesOrdersService.update(id, buildPayload());
        applyOrder(updated);
        toast.success(t("common.saved"));
      } else {
        const created = await salesOrdersService.create(buildPayload());
        toast.success(t("common.saved"));
        router.replace(`/sales/orders/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (orderId: string) => Promise<SalesOrderRow | null>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      if (!updated) return;
      // Transition responses are partial (no payment summary / related
      // documents); always re-read the full document before rendering it.
      applyOrder(await salesOrdersService.get(id));
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
    const payload = buildOrderPrintPayload(order, {
      companyName: activeCompany?.name ?? "",
      companyLogoUrl: activeCompany?.logoUrl ?? null,
      printedByName: user?.fullName ?? null,
      t,
    });
    printDocument(payload);
  };

  const totals: DocumentTotals | null = order
    ? {
        subtotal: Number(order.subtotal),
        discountTotal: Number(order.discountTotal),
        taxTotal: Number(order.taxTotal),
        grandTotal: Number(order.grandTotal),
      }
    : null;

  const config: SalesDocumentEditorConfig<SalesOrderRow> = useMemo(
    () => ({
      title: t("sales.orders.editorTitle"),
      documentType: "SALES_ORDER_DOC",
      permissions: {
        create: "sales.orders.create",
        edit: "sales.orders.edit",
        approve: "sales.orders.approve",
        cancel: "sales.orders.cancel",
        confirm: "sales.orders.confirm",
      },
      statusOptions: buildOrderStatusOptions(t),
      numbering: { documentType: "SALES_ORDER_DOC", docCodePreview: "SO" },
      requireWarehouse: true,
      toolbarExtra: (
        <EnterpriseButton
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={isSaving || isTransitioning || (!!order && order.status !== "DRAFT")}
          onClick={handleSave}
        >
          <Save className="size-3.5" />
          {t("common.save")}
        </EnterpriseButton>
      ),
      trace: { kind: "SALES_ORDER", id },
      workflowActions: [
        {
          key: "submit",
          primary: true,
          label: t("sales.orders.actions.submit"),
          icon: Send,
          visibleForStatuses: ["DRAFT"],
          onAction: () =>
            runTransition((oid) => salesOrdersService.submit(oid), "sales.orders.toasts.submitted"),
        },
        {
          key: "approve",
          primary: true,
          label: t("sales.orders.actions.approve"),
          icon: CheckCircle2,
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL"],
          onAction: () =>
            runTransition((oid) => salesOrdersService.approve(oid), "sales.orders.toasts.approved"),
        },
        {
          key: "confirm",
          primary: true,
          label: t("sales.orders.actions.confirm"),
          icon: PackageCheck,
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
          confirm: {
            title: t("docFlow.flow.orderTitle"),
            description: t("docFlow.flow.orderDescription"),
          },
          onAction: () =>
            runTransition(
              (oid) => salesOrdersService.confirm(oid),
              "sales.orders.toasts.confirmed",
            ),
        },
        {
          key: "convert",
          primary: true,
          label: t("sales.orders.actions.convertToInvoice"),
          icon: ArrowRightCircle,
          visibleForStatuses: ["CONFIRMED", "PARTIALLY_DELIVERED"],
          onAction: () => setConvertOpen(true),
        },
        {
          key: "cancel",
          label: t("sales.orders.actions.cancel"),
          icon: Ban,
          destructive: true,
          visibleForStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "CONFIRMED"],
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
          documentLabel: order?.orderNumber ?? "",
          canCreate: hasPermission("sales.orders.create"),
          canEdit: hasPermission("sales.orders.edit"),
          returnToDraftStatuses: ["PENDING_APPROVAL", "APPROVED", "CONFIRMED", "CANCELLED"],
          onDuplicate: async () => {
            if (!id) return;
            try {
              const copy = await salesOrdersService.duplicate(id);
              toast.success(t("docFlow.lifecycle.duplicated", { number: copy.orderNumber }));
              router.push(`/sales/orders/${copy.id}`);
            } catch (error) {
              toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
            }
          },
          onReturnToDraft: () =>
            runTransition(
              (docId) => salesOrdersService.returnToDraft(docId),
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
      order,
      customer,
      currency,
      lines,
      referenceNumber,
      notes,
      terms,
      id,
    ],
  );

  const state: SalesDocumentEditorState<SalesOrderRow> = {
    document: order,
    documentNumber: order?.orderNumber ?? null,
    status: order?.status ?? "DRAFT",
    documentDate: order ? new Date(order.createdAt) : new Date(),
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
    // Sales Order has no editable date column server-side — the date shown is createdAt.
    onDocumentDateChange: () => undefined,
    onSalespersonChange: () => undefined,
    onCustomerChange: setCustomer,
    onCurrencyChange: setCurrency,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onTermsChange: setTerms,
    onLinesChange: setLines,
  };

  const canEdit = !order || order.status === "DRAFT";
  const canApprove = hasPermission("sales.orders.approve");
  const canConfirm = hasPermission("sales.orders.confirm");
  const canCancel = hasPermission("sales.orders.cancel");

  useBreadcrumbLabel(order?.orderNumber ?? t("sales.orders.addNew"));

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
        title={t("sales.orders.confirmCancelTitle")}
        description={t("sales.orders.confirmCancelDescription")}
        confirmLabel={t("sales.orders.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setCancelTarget(false);
          await runTransition(
            (oid) => salesOrdersService.cancel(oid),
            "sales.orders.toasts.cancelled",
          );
        }}
      />

      {order && (
        <ConvertToInvoiceDialog
          open={convertOpen}
          onOpenChange={setConvertOpen}
          order={order}
          onConverted={(invoice) => router.push(`/sales/invoices/${invoice.id}`)}
        />
      )}
    </EditorWorkspace>
  );
}
