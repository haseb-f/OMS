"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, FileText, Link as LinkIcon, Receipt, Wallet } from "lucide-react";
import { StoreOrderAddPaymentDialog } from "@/components/store-orders/store-order-add-payment-dialog";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
  BackButton,
} from "@/components/shared/detail-workspace";
import { RowActionsMenu } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  storeOrdersService,
  type StoreOrderActivityEntry,
  type StoreOrderRow,
} from "@/services/store-orders-service";
import {
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_TONE,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_TONE,
  isReadyForShipping,
} from "@/config/store-orders/status";
import { shipmentStatusLabelKey, shipmentStatusTone } from "@/config/shipping/shipment-status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate, formatDateTime } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import type { MessageKey } from "@/i18n/translate";

function StoreOrderDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("store-orders.edit");
  const canArchive = hasPermission("store-orders.archive");

  const [order, setOrder] = useState<StoreOrderRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activities, setActivities] = useState<StoreOrderActivityEntry[] | null>(null);
  const [noteText, setNoteText] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [receiptName, setReceiptName] = useState("");
  const [isAttachingReceipt, setIsAttachingReceipt] = useState(false);
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  useBreadcrumbLabel(order?.internalOrderId ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setOrder(await storeOrdersService.get(params.id));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load store order.");
      setOrder(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    storeOrdersService
      .activities(params.id)
      .then(setActivities)
      .catch(() => setActivities([]));
  }, [params.id]);

  const handleAddNote = async () => {
    if (!noteText.trim() || !order) return;
    setIsSavingNote(true);
    try {
      const updated = await storeOrdersService.addNote(order.id, noteText.trim());
      setOrder(updated);
      setNoteText("");
      toast.success(t("storeOrders.detail.notes.added"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to save note.");
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
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to generate invoice.");
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
    if (!order || !receiptUrl.trim() || !receiptName.trim()) return;
    setIsAttachingReceipt(true);
    try {
      const receipt = await storeOrdersService.receipts.attach(order.id, {
        fileUrl: receiptUrl.trim(),
        fileName: receiptName.trim(),
      });
      setOrder((current) =>
        current ? { ...current, receipts: [...(current.receipts ?? []), receipt] } : current,
      );
      setReceiptUrl("");
      setReceiptName("");
      toast.success(t("storeOrders.detail.receipts.attached"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to attach receipt.");
    } finally {
      setIsAttachingReceipt(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <BackButton href="/store-orders" />
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <BackButton href="/store-orders" />
        <EmptyState icon={FileText} title={t("common.noResults")} />
      </div>
    );
  }

  const timelineEntries: TimelineEntry[] = (activities ?? []).map((entry) => ({
    id: entry.id,
    title: entry.details ? `${entry.action} — ${entry.details}` : entry.action,
    timestamp: formatDateTime(entry.createdAt),
    actor: entry.performedBy ?? undefined,
    status: "done",
  }));

  const invoice = order.invoices?.[0] ?? null;
  const canGenerateInvoice = order.paymentStatus === "FULLY_PAID_RECONCILED" && !invoice;
  const paidAmount = (order.payments ?? []).reduce(
    (sum, payment) => sum + Number(payment.amount),
    0,
  );
  const remainingAmount = Number(order.total ?? 0) - paidAmount;
  const latestPayment = order.payments?.[0] ?? null;
  const latestShipmentRow = order.shipments?.[0] ?? null;
  const phone = order.customer?.phone || order.customer?.mobile || null;

  return (
    <DetailWorkspace
      backHref="/store-orders"
      title={
        <SemanticValue kind="id" className="text-ui-title font-semibold">
          {order.internalOrderId}
        </SemanticValue>
      }
      subtitle={
        order.externalOrderId ? (
          <SemanticValue kind="id">{order.externalOrderId}</SemanticValue>
        ) : undefined
      }
      status={
        <>
          <StatusBadge
            label={t(PAYMENT_STATUS_LABEL_KEY[order.paymentStatus])}
            tone={PAYMENT_STATUS_TONE[order.paymentStatus]}
          />
          <StatusBadge
            label={t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage])}
            tone={SHIPPING_STAGE_TONE[order.shippingStage]}
          />
        </>
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "add-payment",
              label: t("storeOrders.detail.payments.add"),
              icon: Wallet,
              hidden: !canEdit,
              onSelect: () => setAddPaymentOpen(true),
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
    >
      <DetailSection title={t("storeOrders.detail.sections.orderSummary")}>
        <DetailFieldGrid columns={3}>
          <DetailField
            label={t("storeOrders.fields.orderDate")}
            value={formatDate(order.orderDate)}
          />
          <DetailField
            label={t("storeOrders.fields.source")}
            value={
              order.sourceChannel
                ? `${t(`storeOrders.source.${order.source}` as MessageKey)} · ${order.sourceChannel}`
                : t(`storeOrders.source.${order.source}` as MessageKey)
            }
          />
          <DetailField
            label={t("storeOrders.fields.total")}
            value={<MoneyValue value={order.total ?? "0"} currency={order.currency} />}
          />
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={t("storeOrders.detail.sections.customer")}>
        <DetailFieldGrid columns={3}>
          <DetailField label={t("storeOrders.fields.customer")} value={order.customer?.name} />
          <DetailField
            label={t("storeOrders.fields.phone")}
            value={phone ? <SemanticValue kind="phone">{phone}</SemanticValue> : undefined}
          />
          {order.customer?.email ? (
            <DetailField
              label={t("storeOrders.createDialog.fields.customerEmail")}
              value={<SemanticValue kind="email">{order.customer.email}</SemanticValue>}
            />
          ) : null}
          {order.customer?.address || order.customer?.city ? (
            <DetailField
              label={t("storeOrders.createDialog.fields.address")}
              value={[order.customer.address, order.customer.city].filter(Boolean).join("، ")}
            />
          ) : null}
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={t("storeOrders.detail.sections.items")}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("storeOrders.detail.items.product")}</TableHead>
                <TableHead className="text-end">{t("storeOrders.detail.items.quantity")}</TableHead>
                <TableHead className="text-end">
                  {t("storeOrders.detail.items.unitPrice")}
                </TableHead>
                <TableHead className="text-end">{t("storeOrders.fields.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {t("common.noResults")}
                  </TableCell>
                </TableRow>
              ) : (
                order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.product?.name ?? item.productId}</TableCell>
                    <TableCell className="text-end">
                      <SemanticValue kind="number">{item.quantity}</SemanticValue>
                    </TableCell>
                    <TableCell className="text-end">
                      <MoneyValue value={item.unitPrice} currency={order.currency} />
                    </TableCell>
                    <TableCell className="text-end">
                      <MoneyValue
                        value={Number(item.unitPrice) * item.quantity}
                        currency={order.currency}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DetailSection>

      <DetailSection title={t("storeOrders.detail.sections.payments")}>
        <DetailFieldGrid columns={3}>
          <DetailField
            label={t("storeOrders.detail.payments.method")}
            value={latestPayment?.paymentSource?.name}
          />
          <DetailField
            label={t("storeOrders.detail.payments.paid")}
            value={<MoneyValue value={paidAmount} currency={order.currency} />}
          />
          <DetailField
            label={t("storeOrders.detail.payments.remaining")}
            value={<MoneyValue value={remainingAmount} currency={order.currency} />}
          />
        </DetailFieldGrid>
        {order.payments && order.payments.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("storeOrders.detail.payments.number")}</TableHead>
                  <TableHead>{t("storeOrders.detail.payments.date")}</TableHead>
                  <TableHead className="text-end">
                    {t("storeOrders.detail.payments.amount")}
                  </TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      <SemanticValue kind="id">{payment.paymentNumber}</SemanticValue>
                    </TableCell>
                    <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                    <TableCell className="text-end">
                      <MoneyValue value={payment.amount} currency={order.currency} />
                    </TableCell>
                    <TableCell>{payment.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </DetailSection>

      {invoice ? (
        <DetailSection title={t("storeOrders.detail.sections.invoice")}>
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <SemanticValue kind="id" className="font-medium">
              {invoice.invoiceNumber}
            </SemanticValue>
          </div>
        </DetailSection>
      ) : null}

      {latestShipmentRow || isReadyForShipping(order.paymentStatus) ? (
        <DetailSection title={t("storeOrders.detail.sections.shipping")}>
          <DetailFieldGrid columns={3}>
            <DetailField
              label={t("shipping.fields.shippingCompany")}
              value={latestShipmentRow?.shippingCompany?.name}
            />
            <DetailField
              label={t("shipping.fields.trackingNumber")}
              value={
                latestShipmentRow?.trackingNumber ? (
                  <SemanticValue kind="id">{latestShipmentRow.trackingNumber}</SemanticValue>
                ) : undefined
              }
            />
            <DetailField
              label={t("shipping.fields.status")}
              value={
                latestShipmentRow ? (
                  <StatusBadge
                    label={t(shipmentStatusLabelKey(latestShipmentRow.status))}
                    tone={shipmentStatusTone(latestShipmentRow.status)}
                  />
                ) : undefined
              }
            />
            <DetailField
              label={t("common.createdAt")}
              value={
                latestShipmentRow?.shippedAt
                  ? formatDate(latestShipmentRow.shippedAt)
                  : latestShipmentRow
                    ? formatDate(latestShipmentRow.createdAt)
                    : undefined
              }
            />
          </DetailFieldGrid>
          {order.shipments && order.shipments.length > 1 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("storeOrders.detail.shipmentHistory.attempt")}</TableHead>
                    <TableHead>{t("shipping.fields.shippingCompany")}</TableHead>
                    <TableHead>{t("shipping.fields.trackingNumber")}</TableHead>
                    <TableHead>{t("shipping.fields.status")}</TableHead>
                    <TableHead>{t("common.createdAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.shipments
                    .slice()
                    .sort((a, b) => a.attemptNumber - b.attemptNumber)
                    .map((shipment) => (
                      <TableRow key={shipment.id}>
                        <TableCell>
                          <SemanticValue kind="number">#{shipment.attemptNumber}</SemanticValue>
                        </TableCell>
                        <TableCell>{shipment.shippingCompany?.name}</TableCell>
                        <TableCell>
                          {shipment.trackingNumber ? (
                            <SemanticValue kind="id">{shipment.trackingNumber}</SemanticValue>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={t(shipmentStatusLabelKey(shipment.status))}
                            tone={shipmentStatusTone(shipment.status)}
                          />
                        </TableCell>
                        <TableCell>{formatDate(shipment.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </DetailSection>
      ) : null}

      {order.receipts && order.receipts.length > 0 ? (
        <DetailSection title={t("storeOrders.detail.sections.receipts")}>
          <ul className="flex flex-col gap-2">
            {order.receipts.map((receipt) => (
              <li key={receipt.id} className="flex items-center gap-2 text-sm">
                <Receipt className="size-4 text-muted-foreground" />
                <a
                  href={receipt.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="text-primary underline underline-offset-2"
                >
                  {receipt.fileName}
                </a>
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {canEdit ? (
        <DetailSection title={t("storeOrders.detail.receipts.attach")}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-40 flex-1 flex-col gap-1.5">
              <Label>{t("storeOrders.detail.receipts.fileName")}</Label>
              <Input
                value={receiptName}
                onChange={(event) => setReceiptName(event.target.value)}
                placeholder={t("storeOrders.detail.receipts.fileNamePlaceholder")}
              />
            </div>
            <div className="flex min-w-48 flex-[2] flex-col gap-1.5">
              <Label>{t("storeOrders.detail.receipts.url")}</Label>
              <Input
                value={receiptUrl}
                onChange={(event) => setReceiptUrl(event.target.value)}
                dir="ltr"
                placeholder="https://…"
              />
            </div>
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!receiptUrl.trim() || !receiptName.trim() || isAttachingReceipt}
              onClick={handleAttachReceipt}
            >
              <LinkIcon className="size-3.5" />
              {t("storeOrders.detail.receipts.attach")}
            </EnterpriseButton>
          </div>
        </DetailSection>
      ) : null}

      {order.notes ? (
        <DetailSection title={t("storeOrders.detail.sections.notes")}>
          <p className="whitespace-pre-wrap text-body">{order.notes}</p>
        </DetailSection>
      ) : null}

      {canEdit || (activities !== null && timelineEntries.length > 0) ? (
        <DetailSection title={t("storeOrders.detail.sections.activity")}>
          {activities === null ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : timelineEntries.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
          ) : (
            <AuditTimeline entries={timelineEntries} />
          )}
          {canEdit ? (
            <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
              <Label>{t("storeOrders.detail.notes.addLabel")}</Label>
              <Textarea
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                rows={2}
                placeholder={t("storeOrders.detail.notes.placeholder")}
              />
              <EnterpriseButton
                type="button"
                size="sm"
                className="w-fit"
                disabled={!noteText.trim() || isSavingNote}
                onClick={handleAddNote}
              >
                {t("storeOrders.detail.notes.save")}
              </EnterpriseButton>
            </div>
          ) : null}
        </DetailSection>
      ) : null}

      <StoreOrderAddPaymentDialog
        storeOrderId={order.id}
        orderCurrencyId={order.currencyId}
        customerName={order.customer?.name ?? ""}
        open={addPaymentOpen}
        onOpenChange={setAddPaymentOpen}
        onAdded={load}
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
    </DetailWorkspace>
  );
}

export default function StoreOrderDetailPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <StoreOrderDetailContent />
    </PermissionGate>
  );
}
