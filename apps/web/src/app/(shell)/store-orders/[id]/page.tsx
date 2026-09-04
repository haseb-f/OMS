"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  FileText,
  Image as ImageIcon,
  Pencil,
  Receipt,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import { StoreOrderAddPaymentDialog } from "@/components/store-orders/store-order-add-payment-dialog";
import { StoreOrderEditAssignmentDialog } from "@/components/store-orders/store-order-edit-assignment-dialog";
import { StoreOrderEditCustomerDialog } from "@/components/store-orders/store-order-edit-customer-dialog";
import { StoreOrderEditNotesDialog } from "@/components/store-orders/store-order-edit-notes-dialog";
import { ShipmentManageDialog } from "@/components/shipping/shipment-manage-dialog";
import {
  DetailField,
  DetailFieldRow,
  DetailGroup,
  DetailSplitLayout,
  RecordHighlightsHeader,
} from "@/components/shared/detail-workspace";
import { CompactDetailTable, RowActionsMenu } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EntityTabs } from "@/components/business/entity-tabs";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { PermissionGate } from "@/components/shared/permission-gate";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { FileDropField } from "@/components/shared/form-fields";
import {
  storeOrdersService,
  type StoreOrderActivityEntry,
  type StoreOrderRow,
  type StoreOrderShipmentRow,
} from "@/services/store-orders-service";
import {
  shippingCompaniesService,
  type ShippingCompanyOption,
} from "@/services/shipping-companies-service";
import type { ShipmentListRow } from "@/services/shipping-service";
import {
  PAYMENT_STATUS_TONE,
  PAYMENT_TYPE_LABEL_KEY,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_TONE,
  financialStatusLabelKey,
  isReadyForShipping,
  paymentRecordStatusBadge,
} from "@/config/store-orders/status";
import {
  catalogStatusTone,
  shipmentStatusLabelKey,
  shipmentStatusTone,
} from "@/config/shipping/shipment-status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatFileSize } from "@/lib/format-file-size";
import { isImageAttachmentMime } from "@/lib/order-attachments";
import { ApiError } from "@/services/api-client";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import type { MessageKey } from "@/i18n/translate";

const ACTIVITY_PREVIEW = 8;

function toShipmentListRow(order: StoreOrderRow, shipment: StoreOrderShipmentRow): ShipmentListRow {
  return {
    id: shipment.id,
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
    attemptNumber: shipment.attemptNumber,
    shippingCompanyId: shipment.shippingCompanyId,
    shippingCompany: shipment.shippingCompany ?? null,
    trackingNumber: shipment.trackingNumber,
    labelUrl: shipment.labelUrl,
    status: shipment.status,
    shippingStatus: shipment.shippingStatus,
    shippingCost: shipment.shippingCost,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
    createdAt: shipment.createdAt,
  };
}

function StoreOrderDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("store-orders.edit");
  const canArchive = hasPermission("store-orders.archive");
  const canEditCustomer = hasPermission("partners.edit");

  const [order, setOrder] = useState<StoreOrderRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activities, setActivities] = useState<StoreOrderActivityEntry[] | null>(null);
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
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [shippingEditOpen, setShippingEditOpen] = useState(false);
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompanyOption[]>([]);

  useBreadcrumbLabel(order?.internalOrderId ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setOrder(await storeOrdersService.get(params.id));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
      setOrder(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id, t]);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await storeOrdersService.activities(params.id));
    } catch {
      setActivities([]);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadActivities();
  }, [loadActivities]);

  const refreshOrder = async () => {
    const [next] = await Promise.all([storeOrdersService.get(params.id), loadActivities()]);
    setOrder(next);
  };

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
      toast.error(
        error instanceof ApiError ? error.message : t("storeOrders.detail.notes.saveFailed"),
      );
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!order) return;
    setIsGeneratingInvoice(true);
    try {
      await storeOrdersService.generateInvoice(order.id);
      toast.success(t("storeOrders.detail.invoice.generated"));
      await refreshOrder();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const handleArchive = async () => {
    if (!order) return;
    setIsArchiving(true);
    try {
      await storeOrdersService.archive(order.id);
      toast.success(t("common.archive"));
      setArchiveOpen(false);
      router.push("/store-orders");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsArchiving(false);
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
      setUploadProgress(null);
      toast.success(t("storeOrders.detail.receipts.attached"));
      await refreshOrder();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("storeOrders.detail.receipts.attachFailed"),
      );
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
      toast.error(
        error instanceof ApiError ? error.message : t("storeOrders.detail.receipts.removeFailed"),
      );
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
      const blob = await storeOrdersService.receipts.download(order.id, receipt.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("storeOrders.detail.receipts.downloadFailed"),
      );
    }
  };

  const openShippingEdit = () => {
    void shippingCompaniesService
      .listOptions()
      .then(setShippingCompanies)
      .catch(() => {
        setShippingCompanies([]);
      });
    setShippingEditOpen(true);
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

  const invoice = order.invoices?.[0] ?? null;
  const canGenerateInvoice = order.paymentStatus === "FULLY_PAID_RECONCILED" && !invoice;
  const paidAmount = (order.payments ?? []).reduce(
    (sum, payment) => sum + Number(payment.amount),
    0,
  );
  const remainingAmount = Number(order.total ?? 0) - paidAmount;
  const latestPayment = order.payments?.[0] ?? null;
  const latestShipmentRow = order.shipments?.[0] ?? null;
  const phone = order.partner?.phone || order.partner?.mobile || null;
  const visibleActivity = showAllActivity
    ? timelineEntries
    : timelineEntries.slice(0, ACTIVITY_PREVIEW);
  const hiddenActivityCount = Math.max(0, timelineEntries.length - ACTIVITY_PREVIEW);
  const shipmentForDialog = latestShipmentRow ? toShipmentListRow(order, latestShipmentRow) : null;

  const editButton = (label: string, onClick: () => void) =>
    canEdit ? (
      <IconActionButton label={label} onClick={onClick}>
        <Pencil className="size-3.5" />
      </IconActionButton>
    ) : null;

  const overview = (
    <DetailSplitLayout
      main={
        <>
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <div className="border-b border-border/70 px-3 py-1.5">
              <h2 className="text-caption font-semibold">
                {t("storeOrders.detail.sections.items")}
              </h2>
            </div>
            {order.items.length > 0 ? (
              <div className="overflow-x-auto px-1 pb-1">
                <CompactDetailTable
                  columns={[
                    {
                      id: "product",
                      header: t("storeOrders.detail.items.product"),
                      cell: (item) => item.product?.name ?? item.productId,
                    },
                    {
                      id: "quantity",
                      header: t("storeOrders.detail.items.quantity"),
                      align: "end",
                      cell: (item) => <SemanticValue kind="number">{item.quantity}</SemanticValue>,
                    },
                    {
                      id: "unitPrice",
                      header: t("storeOrders.detail.items.unitPrice"),
                      align: "end",
                      cell: (item) => (
                        <MoneyValue value={item.unitPrice} currency={order.currency} />
                      ),
                    },
                    {
                      id: "total",
                      header: t("storeOrders.fields.total"),
                      align: "end",
                      cell: (item) => (
                        <MoneyValue
                          value={
                            item.agreedAmount != null
                              ? Number(item.agreedAmount)
                              : Number(item.unitPrice) * item.quantity
                          }
                          currency={order.currency}
                        />
                      ),
                    },
                  ]}
                  rows={order.items}
                  rowKey={(item) => item.id}
                  footer={
                    <>
                      <TableCell colSpan={3} className="px-2 py-1.5 text-end font-medium">
                        {t("storeOrders.fields.total")}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-end">
                        <MoneyValue value={order.total ?? "0"} currency={order.currency} />
                      </TableCell>
                    </>
                  }
                />
              </div>
            ) : (
              <p className="px-3 py-2 text-caption text-muted-foreground">
                {t("common.noResults")}
              </p>
            )}
          </div>

          <DetailGroup
            title={t("storeOrders.detail.sections.payments")}
            actions={
              canEdit ? (
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setAddPaymentOpen(true)}
                >
                  {t("storeOrders.detail.payments.add")}
                </EnterpriseButton>
              ) : null
            }
          >
            <DetailFieldRow
              label={t("storeOrders.fields.paymentStatus")}
              value={t(financialStatusLabelKey(order.paymentStatus, order.paymentType))}
            />
            <DetailFieldRow
              label={t("storeOrders.detail.payments.method")}
              value={latestPayment?.paymentSource?.name}
            />
            <DetailFieldRow
              label={t("storeOrders.detail.payments.paid")}
              value={<MoneyValue value={paidAmount} currency={order.currency} />}
            />
            <DetailFieldRow
              label={t("storeOrders.detail.payments.remaining")}
              value={<MoneyValue value={remainingAmount} currency={order.currency} />}
            />
            <p className="py-1.5 text-caption text-muted-foreground">
              {t("storeOrders.detail.paymentDerivedHint")}
            </p>
          </DetailGroup>

          <DetailGroup
            title={t("storeOrders.detail.sections.shipping")}
            actions={
              canEdit && latestShipmentRow
                ? editButton(t("storeOrders.detail.edit.shippingTitle"), openShippingEdit)
                : null
            }
          >
            <DetailFieldRow
              label={t("shipping.fields.status")}
              value={
                latestShipmentRow?.shippingStatus?.name ??
                order.shippingStatus?.name ??
                t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage])
              }
            />
            <DetailFieldRow
              label={t("shipping.fields.shippingCompany")}
              value={latestShipmentRow?.shippingCompany?.name}
            />
            <DetailFieldRow
              label={t("shipping.fields.trackingNumber")}
              value={latestShipmentRow?.trackingNumber}
              ltr
            />
            {!isReadyForShipping(order.paymentStatus) && !latestShipmentRow ? (
              <p className="py-1.5 text-caption text-muted-foreground">
                {t("storeOrders.detail.shippingSummary.notReadyHint")}
              </p>
            ) : null}
          </DetailGroup>
        </>
      }
      sidebar={
        <>
          <DetailGroup
            title={t("storeOrders.detail.sections.customer")}
            actions={
              canEditCustomer && order.partner
                ? editButton(t("storeOrders.detail.edit.customerTitle"), () =>
                    setCustomerEditOpen(true),
                  )
                : null
            }
          >
            <DetailFieldRow label={t("storeOrders.fields.customer")} value={order.partner?.name} />
            <DetailFieldRow
              label={t("storeOrders.fields.phone")}
              value={phone ? <SemanticValue kind="phone">{phone}</SemanticValue> : undefined}
            />
            <DetailFieldRow
              label={t("storeOrders.createDialog.fields.customerEmail")}
              value={
                order.partner?.email ? (
                  <SemanticValue kind="email">{order.partner.email}</SemanticValue>
                ) : undefined
              }
            />
            <DetailFieldRow
              label={t("storeOrders.createDialog.fields.address")}
              value={
                order.partner?.address || order.partner?.city
                  ? [order.partner.address, order.partner.city].filter(Boolean).join("، ")
                  : undefined
              }
            />
          </DetailGroup>
          <DetailGroup
            title={t("storeOrders.detail.sections.assignment")}
            actions={editButton(t("storeOrders.detail.edit.assignmentTitle"), () =>
              setAssignmentOpen(true),
            )}
          >
            <DetailFieldRow
              label={t("storeOrders.fields.employee")}
              value={order.employee?.fullName}
            />
            <DetailFieldRow
              label={t("storeOrders.fields.source")}
              value={t(`storeOrders.source.${order.source}` as MessageKey)}
            />
            <DetailFieldRow
              label={t("storeOrders.fields.sourceChannel")}
              value={order.sourceChannel}
            />
          </DetailGroup>
        </>
      }
    />
  );

  const details = (
    <div className="flex flex-col gap-2">
      <DetailGroup
        title={t("storeOrders.detail.tabs.details")}
        actions={editButton(t("storeOrders.detail.edit.notesTitle"), () => setNotesOpen(true))}
      >
        <DetailFieldRow
          label={t("storeOrders.fields.externalOrderId")}
          value={
            order.externalOrderId ? (
              <SemanticValue kind="id">{order.externalOrderId}</SemanticValue>
            ) : undefined
          }
        />
        <DetailFieldRow
          label={t("storeOrders.fields.currency")}
          value={order.currency?.code ?? order.currency?.name}
          ltr
        />
        <DetailFieldRow label={t("storeOrders.fields.employee")} value={order.employee?.fullName} />
        <DetailFieldRow
          label={t("storeOrders.fields.source")}
          value={
            order.sourceChannel
              ? `${t(`storeOrders.source.${order.source}` as MessageKey)} · ${order.sourceChannel}`
              : t(`storeOrders.source.${order.source}` as MessageKey)
          }
        />
        <DetailFieldRow label={t("common.createdAt")} value={formatDate(order.createdAt)} />
        <DetailFieldRow label={t("common.updatedAt")} value={formatDate(order.updatedAt)} />
        <DetailFieldRow
          label={t("storeOrders.detail.sections.notes")}
          value={order.notes ?? undefined}
        />
        {invoice ? (
          <DetailFieldRow
            label={t("storeOrders.detail.sections.invoice")}
            value={<SemanticValue kind="id">{invoice.invoiceNumber}</SemanticValue>}
          />
        ) : null}
      </DetailGroup>

      {order.payments && order.payments.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border/70 px-3 py-1.5">
            <h2 className="text-caption font-semibold">
              {t("storeOrders.detail.sections.payments")}
            </h2>
          </div>
          <div className="overflow-x-auto px-1 pb-1">
            <CompactDetailTable
              columns={[
                {
                  id: "number",
                  header: t("storeOrders.detail.payments.number"),
                  cell: (payment) => (
                    <SemanticValue kind="id">{payment.paymentNumber}</SemanticValue>
                  ),
                },
                {
                  id: "date",
                  header: t("storeOrders.detail.payments.date"),
                  cell: (payment) => formatDate(payment.paymentDate),
                },
                {
                  id: "amount",
                  header: t("storeOrders.detail.payments.amount"),
                  align: "end",
                  cell: (payment) => (
                    <MoneyValue value={payment.amount} currency={order.currency} />
                  ),
                },
                {
                  id: "status",
                  header: t("common.status"),
                  cell: (payment) => {
                    const paymentStatus = paymentRecordStatusBadge(payment.status);
                    return (
                      <StatusBadge
                        label={
                          paymentStatus.labelKey
                            ? t(paymentStatus.labelKey)
                            : paymentStatus.fallback
                        }
                        tone={paymentStatus.tone}
                      />
                    );
                  },
                },
              ]}
              rows={order.payments}
              rowKey={(payment) => payment.id}
            />
          </div>
        </div>
      ) : null}

      {order.shipments && order.shipments.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border/70 px-3 py-1.5">
            <h2 className="text-caption font-semibold">
              {t("storeOrders.detail.sections.shipmentHistory")}
            </h2>
          </div>
          <div className="overflow-x-auto px-1 pb-1">
            <CompactDetailTable
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
                      label={t(shipmentStatusLabelKey(shipment.status))}
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
        </div>
      ) : null}
    </div>
  );

  const activity = (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-3 py-2">
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <Label>{t("storeOrders.detail.notes.addLabel")}</Label>
          <Textarea
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
  );

  const attachments = (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <FileDropField
            files={pendingFiles}
            onFilesChange={setPendingFiles}
            disabled={isAttachingReceipt}
          />
          {uploadProgress ? (
            <p className="mt-2 text-caption text-muted-foreground">
              {t("storeOrders.detail.receipts.uploading", { name: uploadProgress })}
            </p>
          ) : null}
          <EnterpriseButton
            type="button"
            size="sm"
            className="mt-2 w-fit"
            disabled={pendingFiles.length === 0 || isAttachingReceipt}
            onClick={() => void handleAttachReceipt()}
          >
            {t("storeOrders.detail.receipts.attach")}
          </EnterpriseButton>
        </div>
      ) : null}
      {order.receipts && order.receipts.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-md border border-border bg-card">
          {order.receipts.map((receipt) => (
            <li key={receipt.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {isImageAttachmentMime(receipt.mimeType) ? (
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Receipt className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  dir="ltr"
                  className="block truncate text-start text-primary underline underline-offset-2"
                  onClick={() => void openReceipt(receipt)}
                >
                  {receipt.fileName ?? receipt.fileUrl}
                </button>
                <p className="text-caption text-muted-foreground">
                  {[
                    receipt.mimeType?.includes("pdf")
                      ? "PDF"
                      : receipt.mimeType?.replace("image/", "").toUpperCase(),
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
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
      <RecordHighlightsHeader
        identity={
          <span className="inline-flex min-w-0 items-center gap-2">
            <SemanticValue kind="id" className="text-ui-title font-semibold">
              {order.internalOrderId}
            </SemanticValue>
            {order.sourceChannel === "مكرر" ? <StatusBadge label="مكرر" tone="warning" /> : null}
          </span>
        }
        status={
          <>
            <StatusBadge
              label={t(financialStatusLabelKey(order.paymentStatus, order.paymentType))}
              tone={PAYMENT_STATUS_TONE[order.paymentStatus]}
            />
            <StatusBadge
              label={
                order.paymentType
                  ? t(PAYMENT_TYPE_LABEL_KEY[order.paymentType])
                  : t("storeOrders.paymentType.PREPAID")
              }
              tone="neutral"
            />
            <StatusBadge
              label={order.shippingStatus?.name ?? t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage])}
              tone={
                order.shippingStatus
                  ? catalogStatusTone(order.shippingStatus.color)
                  : SHIPPING_STAGE_TONE[order.shippingStage]
              }
            />
          </>
        }
        metrics={
          <>
            <DetailField label={t("storeOrders.fields.customer")} value={order.partner?.name} />
            <DetailField
              label={t("storeOrders.fields.orderDate")}
              value={formatDate(order.orderDate)}
            />
            <DetailField
              label={t("storeOrders.fields.total")}
              value={<MoneyValue value={order.total ?? "0"} currency={order.currency} />}
            />
            <DetailField
              label={t("storeOrders.detail.payments.paid")}
              value={<MoneyValue value={paidAmount} currency={order.currency} />}
            />
            <DetailField
              label={t("storeOrders.detail.payments.remaining")}
              value={<MoneyValue value={remainingAmount} currency={order.currency} />}
            />
          </>
        }
        primaryActions={
          canEdit ? (
            <EnterpriseButton type="button" size="sm" onClick={() => setAddPaymentOpen(true)}>
              <Wallet className="size-3.5" />
              {t("storeOrders.detail.payments.add")}
            </EnterpriseButton>
          ) : null
        }
        moreActions={
          <RowActionsMenu
            label={t("common.moreActions")}
            actions={[
              {
                key: "shipping",
                label: t("storeOrders.detail.edit.shippingTitle"),
                icon: Truck,
                hidden: !canEdit || !latestShipmentRow,
                onSelect: openShippingEdit,
              },
              {
                key: "generate-invoice",
                label: t("storeOrders.detail.invoice.generate"),
                icon: FileText,
                hidden: !canEdit || !canGenerateInvoice,
                disabled: isGeneratingInvoice,
                onSelect: () => void handleGenerateInvoice(),
              },
              {
                key: "archive",
                label: t("common.archive"),
                icon: Archive,
                hidden: !canArchive,
                destructive: true,
                separatorBefore: true,
                onSelect: () => setArchiveOpen(true),
              },
            ]}
          />
        }
      />

      <EntityTabs
        defaultValue="overview"
        tabs={[
          { value: "overview", label: t("storeOrders.detail.tabs.overview"), content: overview },
          { value: "details", label: t("storeOrders.detail.tabs.details"), content: details },
          {
            value: "activity",
            label: t("storeOrders.detail.tabs.activity"),
            badge:
              timelineEntries.length > 0 ? (
                <span className="text-caption text-muted-foreground">{timelineEntries.length}</span>
              ) : undefined,
            content: activity,
          },
          {
            value: "attachments",
            label: t("storeOrders.detail.tabs.attachments"),
            badge:
              order.receipts && order.receipts.length > 0 ? (
                <span className="text-caption text-muted-foreground">{order.receipts.length}</span>
              ) : undefined,
            content: attachments,
          },
        ]}
      />

      <StoreOrderAddPaymentDialog
        storeOrderId={order.id}
        orderCurrencyId={order.currencyId}
        customerName={order.partner?.name ?? ""}
        open={addPaymentOpen}
        onOpenChange={setAddPaymentOpen}
        onAdded={() => void refreshOrder()}
      />
      <StoreOrderEditAssignmentDialog
        orderId={order.id}
        employeeId={order.employeeId}
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        onSaved={() => void refreshOrder()}
      />
      {order.partner ? (
        <StoreOrderEditCustomerDialog
          customer={order.partner}
          open={customerEditOpen}
          onOpenChange={setCustomerEditOpen}
          onSaved={() => void refreshOrder()}
        />
      ) : null}
      <StoreOrderEditNotesDialog
        orderId={order.id}
        notes={order.notes}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        onSaved={() => void refreshOrder()}
      />
      <ShipmentManageDialog
        shipment={shipmentForDialog}
        open={shippingEditOpen}
        onOpenChange={setShippingEditOpen}
        onUpdated={() => void refreshOrder()}
        shippingCompanies={shippingCompanies}
      />

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isArchiving}
        onConfirm={() => void handleArchive()}
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
