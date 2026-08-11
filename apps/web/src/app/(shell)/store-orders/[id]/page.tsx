"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Link as LinkIcon, Receipt, Wallet } from "lucide-react";
import { StoreOrderAddPaymentDialog } from "@/components/store-orders/store-order-add-payment-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
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
import type { MessageKey } from "@/i18n/translate";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

function formatMoney(value: string | number, currency: string | { code: string } | null) {
  const code = typeof currency === "string" ? currency : (currency?.code ?? "");
  return `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
}

function StoreOrderDetailContent() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("store-orders.manage");

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
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }
  if (!order) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
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

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/store-orders">{t("storeOrders.title")}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage dir="ltr">{order.internalOrderId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={order.internalOrderId}
        subtitle={
          order.externalOrderId
            ? `${t("storeOrders.fields.externalOrderId")}: ${order.externalOrderId}`
            : undefined
        }
      />

      {/* 1. Customer info */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>{t("storeOrders.detail.sections.customer")}</EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          <dl className="flex flex-col">
            <InfoRow label={t("storeOrders.fields.customer")} value={order.customer?.name ?? ""} />
            <InfoRow label={t("storeOrders.fields.phone")} value={order.customer?.phone ?? ""} />
          </dl>
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 2. Order info (items table) */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>{t("storeOrders.detail.sections.orderInfo")}</EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent className="flex flex-col gap-4">
          <dl className="flex flex-col">
            <InfoRow
              label={t("storeOrders.fields.orderDate")}
              value={formatDate(order.orderDate)}
            />
            <InfoRow
              label={t("storeOrders.fields.source")}
              value={t(`storeOrders.source.${order.source}` as MessageKey)}
            />
            {order.sourceChannel && (
              <InfoRow label={t("storeOrders.fields.sourceChannel")} value={order.sourceChannel} />
            )}
          </dl>
          <div className="overflow-x-auto rounded-md border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("storeOrders.detail.items.product")}</TableHead>
                  <TableHead className="text-end">
                    {t("storeOrders.detail.items.quantity")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("storeOrders.detail.items.unitPrice")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      {t("common.noResults")}
                    </TableCell>
                  </TableRow>
                ) : (
                  order.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.product?.name ?? item.productId}</TableCell>
                      <TableCell className="text-end" dir="ltr">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-end" dir="ltr">
                        {formatMoney(item.unitPrice, order.currency?.code ?? "")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 3. Payment info */}
      <EnterpriseCard>
        <EnterpriseCardHeader className="flex flex-row items-center justify-between gap-3">
          <EnterpriseCardTitle>{t("storeOrders.detail.sections.payments")}</EnterpriseCardTitle>
          {canManage && (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setAddPaymentOpen(true)}
            >
              <Wallet className="size-3.5" />
              {t("storeOrders.detail.payments.add")}
            </EnterpriseButton>
          )}
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          {!order.payments || order.payments.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("storeOrders.detail.payments.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border/60">
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
                      <TableCell dir="ltr">{payment.paymentNumber}</TableCell>
                      <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                      <TableCell className="text-end" dir="ltr">
                        {formatMoney(payment.amount, order.currency)}
                      </TableCell>
                      <TableCell>{payment.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 4. Reconciliation status */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("storeOrders.detail.sections.reconciliation")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent className="flex flex-col gap-2">
          <StatusBadge
            label={t(PAYMENT_STATUS_LABEL_KEY[order.paymentStatus])}
            tone={PAYMENT_STATUS_TONE[order.paymentStatus]}
          />
          <p className="text-caption text-muted-foreground">
            {t(`storeOrders.paymentStatus.explanation.${order.paymentStatus}` as MessageKey)}
          </p>
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 5. Invoice/accounting status */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>{t("storeOrders.detail.sections.invoice")}</EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent className="flex flex-col gap-3">
          {invoice ? (
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <span dir="ltr" className="font-medium">
                {invoice.invoiceNumber}
              </span>
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("storeOrders.detail.invoice.notGenerated")}
            </p>
          )}
          {canManage && !invoice && (
            <EnterpriseButton
              type="button"
              size="sm"
              className="w-fit"
              disabled={!canGenerateInvoice || isGeneratingInvoice}
              onClick={handleGenerateInvoice}
              title={canGenerateInvoice ? undefined : t("storeOrders.detail.invoice.gatedHint")}
            >
              {t("storeOrders.detail.invoice.generate")}
            </EnterpriseButton>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 6. Shipping summary */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("storeOrders.detail.sections.shippingSummary")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent className="flex flex-col gap-2">
          <StatusBadge
            label={t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage])}
            tone={SHIPPING_STAGE_TONE[order.shippingStage]}
          />
          {!isReadyForShipping(order.paymentStatus) && (
            <p className="text-caption text-muted-foreground">
              {t("storeOrders.detail.shippingSummary.notReadyHint")}
            </p>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 7. Shipment history — every attempt, never hidden/overwritten */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("storeOrders.detail.sections.shipmentHistory")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          {!order.shipments || order.shipments.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("storeOrders.detail.shipmentHistory.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border/60">
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
                        <TableCell dir="ltr">#{shipment.attemptNumber}</TableCell>
                        <TableCell>{shipment.shippingCompany?.name ?? "—"}</TableCell>
                        <TableCell dir="ltr">{shipment.trackingNumber ?? "—"}</TableCell>
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
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 8. Receipts */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>{t("storeOrders.detail.sections.receipts")}</EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent className="flex flex-col gap-4">
          {!order.receipts || order.receipts.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("storeOrders.detail.receipts.empty")}
            </p>
          ) : (
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
          )}
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-4">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>{t("storeOrders.detail.receipts.fileName")}</Label>
                <Input
                  value={receiptName}
                  onChange={(event) => setReceiptName(event.target.value)}
                  placeholder={t("storeOrders.detail.receipts.fileNamePlaceholder")}
                />
              </div>
              <div className="flex flex-[2] flex-col gap-1.5">
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
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* 9. Activity / Audit history */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>{t("storeOrders.detail.sections.activity")}</EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent className="flex flex-col gap-4">
          {activities === null ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : timelineEntries.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
          ) : (
            <AuditTimeline entries={timelineEntries} />
          )}
          {canManage && (
            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <Label>{t("storeOrders.detail.notes.addLabel")}</Label>
              <Textarea
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                rows={3}
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
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      <StoreOrderAddPaymentDialog
        storeOrderId={order.id}
        orderCurrencyId={order.currencyId}
        customerName={order.customer?.name ?? ""}
        open={addPaymentOpen}
        onOpenChange={setAddPaymentOpen}
        onAdded={load}
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
