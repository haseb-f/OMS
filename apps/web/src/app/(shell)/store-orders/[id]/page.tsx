"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  FileText,
  Image as ImageIcon,
  PenLine,
  Pencil,
  Printer,
  Receipt,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import { PaymentDeclarationDialog } from "@/components/payments/declaration/payment-declaration-dialog";
import {
  OrderPaymentStatusPanel,
  PaymentDiscrepancyAlert,
} from "@/components/payments/declaration/order-payment-status-panel";
import { StoreOrderPickupPanel } from "@/components/store-orders/store-order-pickup-panel";
import { SetPaymentFeeDialog } from "@/components/store-orders/set-payment-fee-dialog";
import { StoreOrderEditAssignmentDialog } from "@/components/store-orders/store-order-edit-assignment-dialog";
import { StoreOrderEditNotesDialog } from "@/components/store-orders/store-order-edit-notes-dialog";
import { StoreOrderLineAmountsDialog } from "@/components/store-orders/store-order-line-amounts-dialog";
import { DuplicateReviewDialog } from "@/components/store-orders/duplicate-review-dialog";
import { OrderAmendDialog } from "@/components/store-orders/order-amend-dialog";
import { OrderAmendmentHistory } from "@/components/store-orders/order-amendment-history";
import {
  OrderCardNotice,
  StoreOrderCompactCard,
} from "@/components/store-orders/store-order-compact-card";
import {
  StoreOrderWorkflowTracks,
  storeOrderFulfillmentCode,
} from "@/components/store-orders/store-order-workflow-tracks";
import { ShipmentManageDialog } from "@/components/shipping/shipment-manage-dialog";
import {
  ShippingHandoffNotice,
  useShippingHandoff,
} from "@/components/shipping/shipping-handoff-notice";
import {
  CollapsibleDetailSection,
  DetailFieldRow,
  RecordHighlightsHeader,
} from "@/components/shared/detail-workspace";
import { CompactDetailTable } from "@/components/shared/data-table";
import { HeaderActions, type ActionSpec } from "@/components/shared/header-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EntityTabs } from "@/components/business/entity-tabs";
import { OrderProfitabilityPanel } from "@/components/store-orders/order-profitability-panel";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { PermissionGate } from "@/components/shared/permission-gate";
import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { FileDropField } from "@/components/shared/form-fields";
import { AttachmentPreviewDialog } from "@/components/business/attachment-preview-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { AgentOrderPanel } from "@/components/agents/agent-order-panel";
import { AgentBadge } from "@/components/agents/agent-options";
import { PaymentMatchPanel } from "@/components/payments/match-panel/payment-match-panel";
import type { SearchableSelectOption } from "@/components/shared/searchable-select";
import { attachmentsService } from "@/services/attachments-service";
import {
  storeOrdersService,
  type StoreOrderActivityEntry,
  type StoreOrderRow,
  type StoreOrderShipmentRow,
  type StoreOrderPaymentRow,
} from "@/services/store-orders-service";
import { productsService } from "@/services/products-service";
import { agentsService } from "@/services/agents-service";
import type { AmendmentHistoryRow } from "@/services/order-amendments-service";
import {
  shippingCompaniesService,
  type ShippingCompanyOption,
} from "@/services/shipping-companies-service";
import type { ShipmentListRow } from "@/services/shipping-service";
import { isReadyForShipping, paymentRecordStatusBadge } from "@/config/store-orders/status";
import {
  shipmentStatusLabelKey,
  shipmentStatusTone,
  shippingStatusName,
} from "@/config/shipping/shipment-status";
import { computeNextAction, type NextActionKind } from "@/config/store-orders/next-action";
import { NEXT_ACTION_ICON } from "@/config/store-orders/next-action-icons";
import {
  orderFulfillmentBadge,
  orderPaymentBadge,
} from "@/config/store-orders/order-status-badges";
import { amendableFromStoreOrder } from "@/config/store-orders/amendment-draft";
import { useCountries, useCurrencies } from "@/hooks/use-reference-data";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { usePrintCompany } from "@/components/print/print-brand";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { buildPackageSlipPayload } from "@/config/store-orders/package-slip-print";
import { toast, reportApiError, reportSuccess } from "@/lib/toast";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { formatFileSize } from "@/lib/format-file-size";
import { isImageAttachmentMime } from "@/lib/order-attachments";
import type { MessageKey } from "@/i18n/translate";

const ACTIVITY_PREVIEW = 8;
/** Remembered per user (per-user browser storage): which detail sections stay open (spec 1C). */
const sectionsKey = (userId: string | undefined) =>
  `oms.orderDetail.${userId ?? "anonymous"}.storeOrder.openSections`;
type SectionKey = "payments" | "shipments" | "history" | "technical";

/** The shipment dialog's row; with no shipment yet, assigning the company creates attempt #1. */
function toShipmentListRow(
  order: StoreOrderRow,
  shipment: StoreOrderShipmentRow | null,
): ShipmentListRow {
  return {
    id: shipment?.id ?? "",
    storeOrderId: order.id,
    storeOrder: {
      id: order.id,
      internalOrderId: order.internalOrderId,
      externalOrderId: order.externalOrderId,
      partner: order.partner
        ? {
            id: order.partner.id,
            name: order.partner.name,
            phone: order.partner.phone,
            country: null,
          }
        : null,
    },
    attemptNumber: shipment?.attemptNumber ?? 1,
    shippingCompanyId: shipment?.shippingCompanyId ?? null,
    shippingCompany: shipment?.shippingCompany ?? null,
    trackingNumber: shipment?.trackingNumber ?? null,
    labelUrl: shipment?.labelUrl ?? null,
    status: shipment?.status ?? null,
    shippingStatus: shipment?.shippingStatus ?? null,
    shippingCost: shipment?.shippingCost ?? null,
    shippedAt: shipment?.shippedAt ?? null,
    deliveredAt: shipment?.deliveredAt ?? null,
    createdAt: shipment?.createdAt ?? order.createdAt,
    isCurrentAttempt: true,
  } as ShipmentListRow;
}

/**
 * Store Order detail — Round 5 spec 1C compact layout: identity header with
 * separate Payment and Fulfillment badges, ONE computed next action, Amend
 * and a compact overflow; one compact order card; everything else is
 * progressive disclosure (remembered per user). Profitability stays an
 * internal-only tab.
 */
function StoreOrderDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t, locale } = useLocale();
  const { hasPermission, user } = useUserContext();
  const printCompany = usePrintCompany();
  const { runPrint } = usePrintEngine();
  const countries = useCountries();
  const currencies = useCurrencies();
  const [isPreparingSlip, setIsPreparingSlip] = useState(false);
  const canEdit = hasPermission("store-orders.edit");
  const canAmend = hasPermission("store-orders.amend");
  const canGenerateInvoiceAction = hasPermission("store-orders.generate_invoice") || canEdit;
  const canArchive = hasPermission("store-orders.archive");
  const canViewProfitability = hasPermission("orders.profitability.view");
  const canEditProfitabilityCosts = hasPermission("orders.profitability.editCosts");
  const canEditCustomer = hasPermission("partners.edit");
  const canDeclarePayment = canEdit || hasPermission("sales.receipts.create");
  const canRecordPickup = canEdit || hasPermission("shipping.edit");
  // R14 W2 (spec-2 §B) — shipping rights only: `store-orders.edit` (sales
  // staff) never opens the carrier / shipment dialog.
  const canManageShipping =
    hasPermission("shipping.edit") || hasPermission("shipping.assign_carrier");
  const canReviewDuplicates = hasPermission("store-orders.duplicate_review");
  const canReviewPayments = hasPermission("sales.receipts.view");

  const [order, setOrder] = useState<StoreOrderRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activities, setActivities] = useState<StoreOrderActivityEntry[] | null>(null);
  const [amendments, setAmendments] = useState<AmendmentHistoryRow[] | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isAttachingReceipt, setIsAttachingReceipt] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [removeReceiptId, setRemoveReceiptId] = useState<string | null>(null);
  const [isRemovingReceipt, setIsRemovingReceipt] = useState(false);
  const [declareOpen, setDeclareOpen] = useState(false);
  const [paymentContext, setPaymentContext] = useState<{
    total: string;
    paid: string;
    outstanding: string;
    claimed?: string;
    remainingToClaim?: string;
    fullySettled?: boolean;
  } | null>(null);
  const [feeDialogPayment, setFeeDialogPayment] = useState<StoreOrderPaymentRow | null>(null);
  const [panelPaymentId, setPanelPaymentId] = useState<string | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [lineAmountsOpen, setLineAmountsOpen] = useState(false);
  const [shippingEditOpen, setShippingEditOpen] = useState(false);
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompanyOption[]>([]);
  const [amendOpen, setAmendOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [handOverOpen, setHandOverOpen] = useState(false);
  const [customerTotal, setCustomerTotal] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [openSections, setOpenSections] = useLocalStorage<Partial<Record<SectionKey, boolean>>>(
    sectionsKey(user?.id),
    {},
  );
  const [preview, setPreview] = useState<{
    title: string;
    mimeType: string | null;
    blob: Blob | null;
  } | null>(null);

  useBreadcrumbLabel(order?.internalOrderId ?? null);

  const loadPaymentContext = useCallback(() => {
    storeOrdersService
      .paymentContext(params.id)
      .then(setPaymentContext)
      .catch(() => setPaymentContext(null));
  }, [params.id]);

  const loadHistory = async () => {
    const [activity, amended] = await Promise.all([
      storeOrdersService.activities(params.id).catch(() => []),
      storeOrdersService.amendments.history(params.id).catch(() => []),
    ]);
    setActivities(activity);
    setAmendments(amended);
  };

  useEffect(() => {
    let cancelled = false;
    storeOrdersService
      .get(params.id)
      .then((loaded) => {
        if (cancelled) return;
        setOrder(loaded);
        storeOrdersService
          .paymentContext(params.id)
          .then(setPaymentContext)
          .catch(() => setPaymentContext(null));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        reportApiError(error, "common.loadFailed");
        setOrder(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      storeOrdersService.activities(params.id).catch(() => []),
      storeOrdersService.amendments.history(params.id).catch(() => []),
    ]).then(([activity, amended]) => {
      if (cancelled) return;
      setActivities(activity);
      setAmendments(amended);
    });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const refreshOrder = async () => {
    const [next] = await Promise.all([storeOrdersService.get(params.id), loadHistory()]);
    setOrder(next);
    loadPaymentContext();
  };

  const sectionProps = (key: SectionKey) => ({
    open: openSections[key] === true,
    onOpenChange: (open: boolean) => setOpenSections((prev) => ({ ...prev, [key]: open })),
  });

  const handleAddNote = async () => {
    if (!order) return;
    const trimmed = noteText.trim();
    if (!trimmed) {
      setNoteError(t("storeOrders.detail.notes.empty"));
      return;
    }
    setNoteError(null);
    setIsSavingNote(true);
    try {
      await storeOrdersService.addNote(order.id, trimmed);
      setNoteText("");
      toast.success(t("storeOrders.detail.notes.added"));
      await refreshOrder();
    } catch (error) {
      reportApiError(error, "storeOrders.detail.notes.saveFailed");
    } finally {
      setIsSavingNote(false);
    }
  };

  // Package slip: reads the server's fulfillment gate; printing changes nothing.
  const handlePrintSlip = () => {
    if (!order) return;
    setIsPreparingSlip(true);
    void runPrint(
      "slip",
      async () =>
        buildPackageSlipPayload(order, await storeOrdersService.canFulfill(order.id), {
          company: { name: printCompany.name, logoUrl: printCompany.logoUrl ?? null },
          printedByName: user?.fullName ?? null,
        }),
      "common.loadFailed",
    ).finally(() => setIsPreparingSlip(false));
  };

  const handleGenerateInvoice = async () => {
    if (!order) return;
    setIsGeneratingInvoice(true);
    try {
      await storeOrdersService.generateInvoice(order.id);
      toast.success(t("storeOrders.detail.invoice.generated"));
      await refreshOrder();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const handleArchive = async () => {
    if (!order) return;
    try {
      await storeOrdersService.archive(order.id);
      toast.success(t("storeOrders.toasts.archived"));
      router.push("/store-orders");
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    }
  };

  const handleAttachReceipt = async () => {
    if (!order || pendingFiles.length === 0) return;
    setIsAttachingReceipt(true);
    try {
      for (const file of pendingFiles) {
        setUploadProgress(file.name);
        await storeOrdersService.receipts.upload(order.id, file);
      }
      setPendingFiles([]);
      toast.success(t("storeOrders.detail.receipts.attached"));
      await refreshOrder();
    } catch (error) {
      reportApiError(error, "storeOrders.detail.receipts.attachFailed");
    } finally {
      setUploadProgress(null);
      setIsAttachingReceipt(false);
    }
  };

  const handleRemoveReceipt = async () => {
    if (!order || !removeReceiptId) return;
    setIsRemovingReceipt(true);
    try {
      await storeOrdersService.receipts.archive(order.id, removeReceiptId);
      setRemoveReceiptId(null);
      toast.success(t("storeOrders.detail.receipts.removed"));
      await refreshOrder();
    } catch (error) {
      reportApiError(error, "storeOrders.detail.receipts.removeFailed");
    } finally {
      setIsRemovingReceipt(false);
    }
  };

  const openReceipt = async (receipt: NonNullable<StoreOrderRow["receipts"]>[number]) => {
    if (!order) return;
    if (receipt.source !== "UPLOAD") {
      window.open(receipt.fileUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const blob = receipt.attachmentId
        ? await attachmentsService.download(receipt.attachmentId)
        : await storeOrdersService.receipts.download(order.id, receipt.id);
      setPreview({
        title: receipt.fileName ?? t("storeOrders.detail.receipts.fileName"),
        mimeType: receipt.mimeType ?? blob.type,
        blob,
      });
    } catch (error) {
      reportApiError(error, "storeOrders.detail.receipts.downloadFailed");
    }
  };

  const openShippingEdit = () => {
    void shippingCompaniesService
      .listOptions()
      .then(setShippingCompanies)
      .catch(() => setShippingCompanies([]));
    setShippingEditOpen(true);
  };

  /** Company orders search company-owned sellable products, agent orders the agent's own. */
  const searchAmendProducts = async (query: string): Promise<SearchableSelectOption[]> => {
    if (!order) return [];
    const needle = query.trim().toLocaleLowerCase();
    if (order.agentId) {
      const result = await agentsService.products.list(order.agentId);
      return result.items
        .filter((product) => product.status === "ACTIVE" && product.isSellable)
        .filter(
          (product) =>
            !needle ||
            [product.name, product.displayName, product.nameEn, product.sku]
              .filter(Boolean)
              .some((text) => String(text).toLocaleLowerCase().includes(needle)),
        )
        .slice(0, 50)
        .map((product) => ({
          value: product.id,
          label: product.displayName || product.name,
          description: product.sku,
        }));
    }
    const result = await productsService.catalog({
      search: query.trim() || undefined,
      pageSize: 50,
      isSellable: true,
    });
    return result.items
      .filter((product) => !product.ownerAgentId)
      .map((product) => ({ value: product.id, label: product.name, description: product.sku }));
  };

  const runPickup = async (code: "READY_FOR_PICKUP" | "COLLECTED") => {
    if (!order) return;
    setActionBusy(true);
    try {
      setOrder(await storeOrdersService.transitionPickup(order.id, code));
      toast.success(t("paymentDeclaration.pickup.success"));
      void loadHistory();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setActionBusy(false);
    }
  };

  const markHandedOver = async () => {
    const shipment = order?.shipments?.[0];
    if (!order || !shipment) return;
    setActionBusy(true);
    try {
      await storeOrdersService.shipments.ship(order.id, shipment.id);
      reportSuccess(t("orderAmendments.nextAction.handedOver"));
      setHandOverOpen(false);
      await refreshOrder();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setActionBusy(false);
    }
  };

  const openCustomerTotal = async () => {
    if (!order) return;
    try {
      const pricing = await agentsService.orderPricing.get(order.id);
      setCustomerTotal(pricing.customerTotalChange?.proposedPayableTotal ?? null);
    } catch (error) {
      reportApiError(error, "common.loadFailed");
    }
  };

  const confirmCustomerTotal = async () => {
    if (!order || customerTotal == null) return;
    setActionBusy(true);
    try {
      await agentsService.orderPricing.confirmCustomerTotal(order.id, customerTotal);
      reportSuccess(
        t("agentPricing.customerTotal.confirmed", {
          total: formatMoney(customerTotal, order.currency?.code),
        }),
      );
      setCustomerTotal(null);
      await refreshOrder();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setActionBusy(false);
    }
  };

  const timelineEntries: TimelineEntry[] = useMemo(
    () =>
      (activities ?? []).map((entry) => ({
        id: entry.id,
        title: entry.details ? `${entry.action} — ${entry.details}` : entry.action,
        timestamp: formatDateTime(entry.createdAt),
        actor: entry.performedBy ?? undefined,
        status: "done" as const,
      })),
    [activities],
  );
  // R6 SHIP — Shipping-queue handoff / blocker, re-read when payment or shipping changes.
  const shippingHandoff = useShippingHandoff(
    params.id,
    order
      ? [
          order.updatedAt,
          order.declaredPaymentStatus,
          order.paymentStatus,
          order.fulfillmentMethod,
          order.shipments?.length ?? 0,
        ].join("|")
      : "",
  );

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
        <EmptyState icon={FileText} title={t("common.noResults")} />
      </div>
    );
  }

  const invoice = order.invoices?.find((row) => row.status !== "CANCELLED") ?? null;
  const paidAmount = Number(paymentContext?.paid ?? 0);
  const remainingAmount = Number(
    paymentContext?.outstanding ?? Math.max(Number(order.total ?? 0) - paidAmount, 0),
  );
  const canDeclareMore = paymentContext
    ? Number(paymentContext.remainingToClaim ?? paymentContext.outstanding) > 0.005 &&
      !paymentContext.fullySettled
    : order.declaredPaymentStatus !== "PAID";
  const isPickup = order.fulfillmentMethod === "PICKUP";
  const fulfillmentAllowed = isReadyForShipping(order);
  const latestShipment = order.shipments?.[0] ?? null;
  const duplicatePending = order.duplicateReviewStatus === "PENDING";

  const next = computeNextAction({
    total: Number(order.total ?? 0),
    isAgentOrder: Boolean(order.agentId),
    paymentType: order.paymentType,
    declaredPaymentStatus: order.declaredPaymentStatus,
    paymentStatus: order.paymentStatus,
    fulfillmentMethod: order.fulfillmentMethod,
    fulfillmentCode: storeOrderFulfillmentCode(order),
    latestShipment: latestShipment
      ? {
          status: latestShipment.status,
          hasCompany: Boolean(latestShipment.shippingCompanyId ?? latestShipment.shippingCompany),
          labelReissueRequired: latestShipment.labelReissueRequired === true,
        }
      : null,
    duplicateReviewPending: duplicatePending,
    customerTotalConfirmationRequired: order.customerTotalStatus === "CONFIRMATION_REQUIRED",
    hasActiveInvoice: Boolean(invoice),
    canDeclareMore,
    can: {
      reviewDuplicates: canReviewDuplicates,
      confirmCustomerTotal: hasPermission("agents.edit"),
      setAmounts: canEdit,
      declarePayment: canDeclarePayment,
      manageShipping: canManageShipping,
      recordPickup: canRecordPickup,
      generateInvoice: canGenerateInvoiceAction,
    },
  });
  const nextHandlers: Record<NextActionKind, () => void> = {
    RESOLVE_DUPLICATE: () => setDuplicateOpen(true),
    CONFIRM_CUSTOMER_TOTAL: () => void openCustomerTotal(),
    SET_AMOUNTS: () => setLineAmountsOpen(true),
    REISSUE_LABEL: openShippingEdit,
    DECLARE_PAYMENT: () => setDeclareOpen(true),
    AWAITING_FINANCE: () => undefined,
    ASSIGN_SHIPPING: openShippingEdit,
    MARK_HANDED_OVER: () => setHandOverOpen(true),
    UPDATE_SHIPMENT: openShippingEdit,
    MARK_READY_FOR_PICKUP: () => void runPickup("READY_FOR_PICKUP"),
    MARK_COLLECTED: () => void runPickup("COLLECTED"),
    GENERATE_INVOICE: () => void handleGenerateInvoice(),
    NONE: () => undefined,
  };
  const primary: ActionSpec | undefined =
    next.actionable && next.labelKey
      ? {
          key: "next-action",
          label: t(next.labelKey),
          icon: NEXT_ACTION_ICON[next.kind],
          testId: "order-next-action",
          disabled: actionBusy || isGeneratingInvoice,
          onSelect: nextHandlers[next.kind],
        }
      : undefined;

  const paymentBadge = orderPaymentBadge(order);
  const fulfillmentBadge = orderFulfillmentBadge({
    fulfillmentMethod: order.fulfillmentMethod,
    fulfillmentStatus: order.fulfillmentStatus,
    latestShipmentStatus: latestShipment?.status ?? null,
    locale,
  });
  const visibleActivity = showAllActivity
    ? timelineEntries
    : timelineEntries.slice(0, ACTIVITY_PREVIEW);
  const hiddenActivityCount = Math.max(0, timelineEntries.length - ACTIVITY_PREVIEW);
  const relatedRefreshKey = [
    order.paymentStatus,
    order.declaredPaymentStatus,
    order.updatedAt,
    order.invoices?.map((row) => row.status).join(),
    order.payments?.map((row) => row.status).join(),
    order.shipments?.map((row) => row.status).join(),
  ].join("|");

  const editButton = (label: string, onClick: () => void, show = canEdit) =>
    show ? (
      <IconActionButton label={label} onClick={onClick}>
        <Pencil className="size-3.5" />
      </IconActionButton>
    ) : null;

  const hasNotices =
    duplicatePending || latestShipment?.labelReissueRequired === true || order.paymentDiscrepancy;
  const notices = hasNotices ? (
    <>
      {duplicatePending ? (
        <OrderCardNotice>
          <span>{t("orderAmendments.detail.duplicateReview")}</span>
          {canReviewDuplicates && next.kind !== "RESOLVE_DUPLICATE" ? (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDuplicateOpen(true)}
            >
              {t("orderAmendments.nextAction.RESOLVE_DUPLICATE")}
            </EnterpriseButton>
          ) : null}
        </OrderCardNotice>
      ) : null}
      {latestShipment?.labelReissueRequired ? (
        <OrderCardNotice>
          {t("orderAmendments.detail.labelReissue", {
            tracking: latestShipment.trackingNumber ?? `#${latestShipment.attemptNumber}`,
          })}
        </OrderCardNotice>
      ) : null}
      {order.paymentDiscrepancy ? (
        <PaymentDiscrepancyAlert reason={order.paymentDiscrepancyReason} />
      ) : null}
    </>
  ) : undefined;

  const paymentsTable =
    order.payments && order.payments.length > 0 ? (
      <div className="overflow-x-auto">
        <CompactDetailTable
          stacked
          columns={[
            {
              id: "number",
              header: t("storeOrders.detail.payments.number"),
              cell: (payment) =>
                canReviewPayments ? (
                  <EnterpriseButton
                    type="button"
                    variant="link"
                    size="inline"
                    onClick={() => setPanelPaymentId(payment.id)}
                  >
                    <SemanticValue kind="id">{payment.paymentNumber}</SemanticValue>
                  </EnterpriseButton>
                ) : (
                  <SemanticValue kind="id">{payment.paymentNumber}</SemanticValue>
                ),
            },
            {
              id: "date",
              header: t("storeOrders.detail.payments.date"),
              cell: (payment) => formatDate(payment.paymentDate),
            },
            {
              id: "method",
              header: t("paymentDeclaration.fields.method"),
              cell: (payment) => payment.paymentMethod?.name ?? payment.paymentSource?.name,
            },
            {
              id: "amount",
              header: t("storeOrders.detail.payments.amount"),
              align: "end",
              cell: (payment) => <MoneyValue value={payment.amount} currency={order.currency} />,
            },
            {
              id: "status",
              header: t("common.status"),
              cell: (payment) => {
                const status = paymentRecordStatusBadge(payment.status);
                const reason = payment.disputeReason ?? payment.rejectionReason;
                return (
                  <span className="inline-flex flex-col items-start gap-0.5">
                    <StatusBadge
                      label={status.labelKey ? t(status.labelKey) : status.fallback}
                      tone={status.tone}
                    />
                    {reason ? (
                      <span className="text-caption text-muted-foreground">{reason}</span>
                    ) : null}
                  </span>
                );
              },
            },
            {
              id: "fee",
              header: t("storeOrders.detail.payments.fee"),
              align: "end",
              cell: (payment) =>
                canEditProfitabilityCosts ? (
                  <EnterpriseButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFeeDialogPayment(payment)}
                  >
                    {payment.actualFeeAmount != null ? (
                      <MoneyValue value={payment.actualFeeAmount} currency={order.currency} />
                    ) : (
                      t("storeOrders.detail.payments.setFee")
                    )}
                  </EnterpriseButton>
                ) : payment.actualFeeAmount != null ? (
                  <MoneyValue value={payment.actualFeeAmount} currency={order.currency} />
                ) : (
                  "—"
                ),
            },
          ]}
          rows={order.payments}
          rowKey={(payment) => payment.id}
        />
      </div>
    ) : null;

  const receipts = (
    <div className="flex flex-col gap-2">
      <h3 className="text-caption font-semibold">{t("storeOrders.detail.tabs.attachments")}</h3>
      {order.receipts && order.receipts.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border">
          {order.receipts.map((receipt) => (
            <li key={receipt.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {isImageAttachmentMime(receipt.mimeType) ? (
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Receipt className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <EnterpriseButton
                  type="button"
                  variant="link"
                  size="inline"
                  dir="ltr"
                  className="h-auto max-w-full truncate px-0 font-normal"
                  onClick={() => void openReceipt(receipt)}
                >
                  {receipt.fileName ?? receipt.fileUrl}
                </EnterpriseButton>
                <p className="text-caption text-muted-foreground">
                  {[
                    formatFileSize(receipt.fileSizeBytes),
                    receipt.createdBy,
                    formatDate(receipt.createdAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canEdit ? (
                <IconActionButton
                  label={t("common.remove")}
                  onClick={() => setRemoveReceiptId(receipt.id)}
                >
                  <Trash2 className="size-3.5" />
                </IconActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-muted-foreground">
          {t("storeOrders.detail.receipts.empty")}
        </p>
      )}
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <FileDropField
            files={pendingFiles}
            onFilesChange={setPendingFiles}
            disabled={isAttachingReceipt}
          />
          {uploadProgress ? (
            <p className="text-caption text-muted-foreground">
              {t("storeOrders.detail.receipts.uploading", { name: uploadProgress })}
            </p>
          ) : null}
          <EnterpriseButton
            type="button"
            size="sm"
            className="w-fit"
            disabled={pendingFiles.length === 0 || isAttachingReceipt}
            onClick={() => void handleAttachReceipt()}
          >
            {t("storeOrders.detail.receipts.attach")}
          </EnterpriseButton>
        </div>
      ) : null}
    </div>
  );

  const overview = (
    <div className="flex min-w-0 flex-col gap-2">
      <StoreOrderCompactCard
        order={order}
        paid={paidAmount}
        outstanding={remainingAmount}
        notices={notices}
      />

      {/* Agent orders — owner agent, shipping pricing notice, finance, returns. */}
      {order.agentId ? (
        <AgentOrderPanel
          order={order}
          onChanged={() => void refreshOrder()}
          showBreakdown={false}
        />
      ) : null}

      {isPickup ? (
        <StoreOrderPickupPanel
          orderId={order.id}
          fulfillmentStatusCode={order.fulfillmentStatus?.code}
          canTransition={canRecordPickup}
          paymentAllowsCollection={fulfillmentAllowed}
          onChanged={() => void refreshOrder()}
        />
      ) : null}

      <CollapsibleDetailSection
        title={t("orderAmendments.detail.sections.payments")}
        summary={t("orderAmendments.detail.summary.payments", {
          count: order.payments?.length ?? 0,
        })}
        testId="section-payments"
        {...sectionProps("payments")}
      >
        <OrderPaymentStatusPanel
          declaredPaymentStatus={order.declaredPaymentStatus}
          declaredAmount={order.declaredAmount}
          paymentStatus={order.paymentStatus}
          claims={order.payments ?? []}
          verifiedAmount={paidAmount}
          remainingAmount={remainingAmount}
          currency={order.currency}
        />
        {paymentsTable}
        {invoice ? (
          <DetailFieldRow
            label={t("storeOrders.detail.sections.invoice")}
            value={
              <RelatedRecordLink
                kind="SALES_INVOICE"
                id={invoice.id}
                number={invoice.invoiceNumber}
                status={invoice.status}
                variant="inline"
                originLabel={`${t("docFlow.kinds.STORE_ORDER")} ${order.internalOrderId}`}
              />
            }
          />
        ) : null}
        <RelatedRecordsPanel kind="STORE_ORDER" id={order.id} refreshKey={relatedRefreshKey} />
        {receipts}
      </CollapsibleDetailSection>

      {!isPickup ? (
        <CollapsibleDetailSection
          title={t("orderAmendments.detail.sections.shipments")}
          summary={
            latestShipment
              ? `${shippingStatusName(latestShipment.shippingStatus, t) ?? t(shipmentStatusLabelKey(latestShipment.status))} · ${t(
                  "orderAmendments.detail.summary.shipments",
                  { count: order.shipments?.length ?? 0 },
                )}`
              : undefined
          }
          actions={editButton(
            t("storeOrders.detail.edit.shippingTitle"),
            openShippingEdit,
            canManageShipping && Boolean(latestShipment),
          )}
          testId="section-shipments"
          {...sectionProps("shipments")}
        >
          <ShippingHandoffNotice
            handoff={shippingHandoff}
            internalOrderId={order.internalOrderId}
            awaitingShipping={latestShipment?.status == null}
          />
          {order.shipments && order.shipments.length > 0 ? (
            <div className="overflow-x-auto">
              <CompactDetailTable
                stacked
                columns={[
                  {
                    id: "attempt",
                    header: t("storeOrders.detail.shipmentHistory.attempt"),
                    cell: (shipment) => (
                      <SemanticValue kind="number">#{shipment.attemptNumber}</SemanticValue>
                    ),
                  },
                  {
                    id: "company",
                    header: t("shipping.fields.shippingCompany"),
                    cell: (shipment) => shipment.shippingCompany?.name,
                  },
                  {
                    id: "tracking",
                    header: t("shipping.fields.trackingNumber"),
                    cell: (shipment) =>
                      shipment.trackingNumber ? (
                        <SemanticValue kind="id">{shipment.trackingNumber}</SemanticValue>
                      ) : null,
                  },
                  {
                    id: "status",
                    header: t("shipping.fields.status"),
                    cell: (shipment) => (
                      <StatusBadge
                        label={
                          shippingStatusName(shipment.shippingStatus, t) ??
                          t(shipmentStatusLabelKey(shipment.status))
                        }
                        tone={shipmentStatusTone(shipment.status)}
                      />
                    ),
                  },
                  {
                    id: "createdAt",
                    header: t("common.createdAt"),
                    cell: (shipment) => formatDate(shipment.createdAt),
                  },
                ]}
                rows={[...order.shipments].sort((a, b) => a.attemptNumber - b.attemptNumber)}
                rowKey={(shipment) => shipment.id}
              />
            </div>
          ) : shippingHandoff?.queued || shippingHandoff?.blocker ? null : (
            <p className="text-caption text-muted-foreground">
              {fulfillmentAllowed
                ? t("storeOrders.shippingStage.READY_FOR_SHIPPING")
                : t("paymentDeclaration.gate.notReadyHint")}
            </p>
          )}
        </CollapsibleDetailSection>
      ) : null}

      <CollapsibleDetailSection
        title={t("orderAmendments.detail.sections.history")}
        summary={t("orderAmendments.detail.summary.history", { count: amendments?.length ?? 0 })}
        testId="section-history"
        {...sectionProps("history")}
      >
        {/* Payment and fulfillment lifecycles as separate read-only trackers. */}
        <StoreOrderWorkflowTracks order={order} />
        <h3 className="border-t border-border/70 pt-2 text-caption font-semibold">
          {t("orderAmendments.detail.amendments.title")}
        </h3>
        <OrderAmendmentHistory rows={amendments} />
        <div className="flex flex-col gap-2 border-t border-border/70 pt-2">
          {canEdit ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="order-note">{t("storeOrders.detail.notes.addLabel")}</Label>
              <Textarea
                id="order-note"
                value={noteText}
                onChange={(event) => {
                  setNoteText(event.target.value);
                  if (noteError) setNoteError(null);
                }}
                rows={2}
                placeholder={t("storeOrders.detail.notes.placeholder")}
              />
              {noteError ? <p className="text-caption text-destructive">{noteError}</p> : null}
              <EnterpriseButton
                type="button"
                size="sm"
                className="w-fit"
                disabled={!noteText.trim() || isSavingNote}
                onClick={() => void handleAddNote()}
              >
                {t("storeOrders.detail.notes.save")}
              </EnterpriseButton>
            </div>
          ) : null}
          {activities === null ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : visibleActivity.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
          ) : (
            <>
              <AuditTimeline entries={visibleActivity} />
              {hiddenActivityCount > 0 && !showAllActivity ? (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => setShowAllActivity(true)}
                >
                  {t("storeOrders.detail.activity.showMore", { count: hiddenActivityCount })}
                </EnterpriseButton>
              ) : null}
            </>
          )}
        </div>
      </CollapsibleDetailSection>

      <CollapsibleDetailSection
        title={t("orderAmendments.detail.sections.technical")}
        actions={editButton(t("storeOrders.detail.edit.notesTitle"), () => setNotesOpen(true))}
        testId="section-technical"
        {...sectionProps("technical")}
      >
        <div className="divide-y divide-border/60">
          <DetailFieldRow
            label={t("orderAmendments.detail.technical.orderId")}
            value={<SemanticValue kind="id">{order.id}</SemanticValue>}
            ltr
          />
          <DetailFieldRow
            label={t("orderAmendments.detail.technical.version")}
            value={String(order.version ?? 0)}
            ltr
          />
          <DetailFieldRow
            label={t("storeOrders.fields.externalOrderId")}
            value={
              order.externalOrderId ? (
                <SemanticValue kind="id">{order.externalOrderId}</SemanticValue>
              ) : undefined
            }
          />
          <DetailFieldRow
            label={t("storeOrders.fields.source")}
            value={
              order.sourceChannel
                ? `${t(`storeOrders.source.${order.source}` as MessageKey)} · ${order.sourceChannel}`
                : t(`storeOrders.source.${order.source}` as MessageKey)
            }
          />
          <DetailFieldRow
            label={t("storeOrders.fields.employee")}
            value={
              <span className="inline-flex items-center gap-1">
                {order.employee?.fullName ?? "—"}
                {editButton(t("storeOrders.detail.edit.assignmentTitle"), () =>
                  setAssignmentOpen(true),
                )}
              </span>
            }
          />
          <DetailFieldRow
            label={t("storeOrders.fields.currency")}
            value={order.currency?.code}
            ltr
          />
          <DetailFieldRow label={t("common.createdAt")} value={formatDate(order.createdAt)} ltr />
          <DetailFieldRow label={t("common.updatedAt")} value={formatDate(order.updatedAt)} ltr />
          <DetailFieldRow
            label={t("storeOrders.detail.sections.notes")}
            value={order.notes ?? undefined}
          />
        </div>
        {order.agentTermsSnapshot ? (
          <details className="text-caption">
            <summary className="cursor-pointer text-muted-foreground">
              {t("orderAmendments.detail.technical.snapshot")}
            </summary>
            <pre
              dir="ltr"
              className="mt-1 max-h-64 overflow-auto rounded-sm bg-surface-sunken p-2 text-micro whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {JSON.stringify(order.agentTermsSnapshot, null, 2)}
            </pre>
          </details>
        ) : null}
      </CollapsibleDetailSection>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-2">
      <RecordHighlightsHeader
        identity={order.internalOrderId}
        copyValue={order.internalOrderId}
        status={
          <span className="flex flex-wrap items-center gap-1.5" data-testid="order-status-badges">
            <StatusBadge
              label={`${t("orderAmendments.detail.payment")}: ${
                paymentBadge.labelKey ? t(paymentBadge.labelKey) : (paymentBadge.label ?? "")
              }`}
              tone={paymentBadge.tone}
            />
            <StatusBadge
              label={`${t("orderAmendments.detail.fulfillment")}: ${
                fulfillmentBadge.labelKey
                  ? t(fulfillmentBadge.labelKey)
                  : (fulfillmentBadge.label ?? "")
              }`}
              tone={fulfillmentBadge.tone}
            />
            {order.agent ? <AgentBadge agent={order.agent} /> : null}
            {!next.actionable && next.labelKey ? (
              <StatusBadge label={t(next.labelKey)} tone="neutral" />
            ) : null}
          </span>
        }
        meta={[
          order.agentTermsSnapshot?.customer?.name ?? order.partner?.name,
          order.orderDate ? formatDate(order.orderDate) : null,
          order.currency?.code,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <HeaderActions
            primary={primary}
            secondary={[
              {
                key: "amend",
                label: t("orderAmendments.action"),
                icon: PenLine,
                testId: "order-amend",
                hidden: !canAmend || (Boolean(order.agentId) && !hasPermission("agents.view")),
                onSelect: () => setAmendOpen(true),
              },
            ]}
            more={[
              {
                key: "print-slip",
                label: t("printDocument.printSlipAction"),
                icon: Printer,
                testId: "print-package-slip",
                disabled: isPreparingSlip,
                onSelect: handlePrintSlip,
              },
              {
                key: "declare-payment",
                label: t("paymentDeclaration.action.declare"),
                icon: Wallet,
                hidden: !(canDeclarePayment && canDeclareMore) || next.kind === "DECLARE_PAYMENT",
                onSelect: () => setDeclareOpen(true),
              },
              {
                key: "shipping",
                label: t("storeOrders.detail.edit.shippingTitle"),
                icon: Truck,
                hidden: !canManageShipping || !latestShipment || isPickup,
                onSelect: openShippingEdit,
              },
              {
                key: "generate-invoice",
                label: t("storeOrders.detail.invoice.generate"),
                icon: FileText,
                hidden:
                  !canGenerateInvoiceAction ||
                  order.paymentStatus !== "FULLY_PAID_RECONCILED" ||
                  Boolean(invoice) ||
                  Boolean(order.agentId) ||
                  next.kind === "GENERATE_INVOICE",
                disabled: isGeneratingInvoice,
                onSelect: () => void handleGenerateInvoice(),
              },
            ]}
            destructive={[
              {
                key: "archive",
                label: t("common.archive"),
                icon: Archive,
                hidden: !canArchive,
                confirm: {
                  title: t("common.confirmArchiveTitle"),
                  description: t("common.confirmArchiveDescription"),
                  confirmLabel: t("common.archive"),
                },
                onSelect: handleArchive,
              },
            ]}
          />
        }
      />

      {canViewProfitability && !order.agentId ? (
        <EntityTabs
          defaultValue="overview"
          tabs={[
            { value: "overview", label: t("storeOrders.detail.tabs.overview"), content: overview },
            {
              value: "profitability",
              label: t("storeOrders.detail.tabs.profitability"),
              content: <OrderProfitabilityPanel storeOrderId={order.id} />,
            },
          ]}
        />
      ) : (
        overview
      )}

      <OrderAmendDialog
        order={amendableFromStoreOrder(order)}
        client={storeOrdersService.amendments}
        options={{
          searchProducts: searchAmendProducts,
          countries: countries.map((country) => ({
            value: country.id,
            label: locale === "en" && country.nameEn ? country.nameEn : country.name,
            searchText: [country.name, country.nameEn, country.code].filter(Boolean).join(" "),
          })),
          currencies: currencies.map((currency) => ({
            value: currency.id,
            label: currency.code,
            description: currency.name,
          })),
          canSwitchCustomer: !order.agentId,
          canCorrectIdentity: Boolean(order.agentId) || canEditCustomer,
        }}
        open={amendOpen}
        onOpenChange={setAmendOpen}
        onAmended={(result) => {
          setOrder(result.order);
          loadPaymentContext();
          void loadHistory();
        }}
        onReload={() => void refreshOrder()}
      />
      <PaymentDeclarationDialog
        storeOrderId={order.id}
        orderCurrencyId={order.currencyId}
        currency={order.currency}
        open={declareOpen}
        onOpenChange={setDeclareOpen}
        onDeclared={() => void refreshOrder()}
      />
      <PaymentMatchPanel
        paymentId={panelPaymentId}
        onOpenChange={(open) => !open && setPanelPaymentId(null)}
        onChanged={() => void refreshOrder()}
      />
      <SetPaymentFeeDialog
        payment={feeDialogPayment}
        open={feeDialogPayment != null}
        onOpenChange={(open) => {
          if (!open) setFeeDialogPayment(null);
        }}
        onSaved={() => void refreshOrder()}
      />
      <StoreOrderEditAssignmentDialog
        orderId={order.id}
        employeeId={order.employeeId}
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        onSaved={() => void refreshOrder()}
      />
      <StoreOrderLineAmountsDialog
        orderId={order.id}
        open={lineAmountsOpen}
        onOpenChange={setLineAmountsOpen}
        onSaved={() => void refreshOrder()}
      />
      <StoreOrderEditNotesDialog
        orderId={order.id}
        notes={order.notes}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        onSaved={() => void refreshOrder()}
      />
      <ShipmentManageDialog
        shipment={shippingEditOpen ? toShipmentListRow(order, latestShipment) : null}
        open={shippingEditOpen}
        onOpenChange={setShippingEditOpen}
        onUpdated={() => void refreshOrder()}
        shippingCompanies={shippingCompanies}
      />
      <DuplicateReviewDialog
        orderId={duplicateOpen ? order.id : null}
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        onResolved={() => void refreshOrder()}
      />
      <ConfirmationDialog
        open={handOverOpen}
        onOpenChange={setHandOverOpen}
        title={t("orderAmendments.nextAction.handedOverTitle")}
        description={t("orderAmendments.nextAction.handedOverDescription")}
        confirmLabel={t("orderAmendments.nextAction.MARK_HANDED_OVER")}
        cancelLabel={t("common.cancel")}
        isConfirming={actionBusy}
        onConfirm={() => void markHandedOver()}
      />
      <ConfirmationDialog
        open={customerTotal != null}
        onOpenChange={(open) => {
          if (!open) setCustomerTotal(null);
        }}
        title={t("orderAmendments.nextAction.CONFIRM_CUSTOMER_TOTAL")}
        description={t("agentPricing.customerTotal.confirmed", {
          total: formatMoney(customerTotal ?? 0, order.currency?.code),
        })}
        confirmLabel={t("orderAmendments.nextAction.CONFIRM_CUSTOMER_TOTAL")}
        cancelLabel={t("common.cancel")}
        isConfirming={actionBusy}
        onConfirm={() => void confirmCustomerTotal()}
      />
      <ConfirmationDialog
        open={Boolean(removeReceiptId)}
        onOpenChange={(open) => {
          if (!open) setRemoveReceiptId(null);
        }}
        tone="destructive"
        title={t("storeOrders.detail.receipts.confirmRemoveTitle")}
        description={t("storeOrders.detail.receipts.confirmRemoveDescription")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        isConfirming={isRemovingReceipt}
        onConfirm={() => void handleRemoveReceipt()}
      />
      <AttachmentPreviewDialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={preview?.title ?? ""}
        mimeType={preview?.mimeType ?? null}
        blob={preview?.blob ?? null}
      />
    </div>
  );
}

export default function StoreOrderDetailPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <StoreOrderDetailContent />
    </PermissionGate>
  );
}
