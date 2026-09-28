"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Info, PackageOpen, Undo2 } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/business/status-badge";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { newIdempotencyKey } from "@/components/payments/declaration/declaration-logic";
import type { WarehouseRow } from "@/config/master-data/entities";
import {
  agentOrderBreakdown,
  buildReturnLines,
  defaultChargeReturnFee,
  isReturnShipment,
  returnShipmentChoices,
  returnedQuantities,
} from "@/config/agents/agent-order";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { agentReturnsService, type AgentReturnRow } from "@/services/agents-service";
import type { StoreOrderItemRow, StoreOrderRow } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { reportApiError, toast } from "@/lib/toast";
import { AgentBadge } from "./agent-options";
import { AgentPaymentStages, RecordRefundDialog } from "./agent-finance-dialogs";
import { FieldNote } from "./field-note";

/** Price breakdown of an order with a pricing mode (spec §5) — agent orders. */
export function OrderPriceBreakdown({ order }: { order: StoreOrderRow }) {
  const { t } = useLocale();
  const breakdown = agentOrderBreakdown(order);
  if (!breakdown) return null;
  const currency = order.currency;
  const showRate =
    breakdown.shippingSource === "MANUAL" &&
    breakdown.shippingRate != null &&
    Math.abs(breakdown.shippingRate - breakdown.shipping) > 0.005;
  const rows: { label: string; value: number; note?: string; emphasis?: boolean }[] = [
    { label: t("agents.storeOrder.merchandise"), value: breakdown.merchandise },
    { label: t("agents.storeOrder.discount"), value: breakdown.discount },
    { label: t("agents.storeOrder.tax"), value: breakdown.tax },
    {
      label: t("agents.storeOrder.shipping"),
      value: breakdown.shipping,
      note: [
        t(`agents.storeOrder.shippingSource.${breakdown.shippingSource}`),
        showRate
          ? t("agents.storeOrder.configuredRate", {
              amount: formatMoney(breakdown.shippingRate ?? 0, currency?.code),
            })
          : null,
        breakdown.shippingOverrideReason
          ? `${t("agents.storeOrder.overrideReason")}: ${breakdown.shippingOverrideReason}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    { label: t("agents.storeOrder.service"), value: breakdown.service },
    { label: t("agents.storeOrder.payable"), value: breakdown.payable, emphasis: true },
  ];
  return (
    <DetailSection
      title={t("agents.storeOrder.breakdownTitle")}
      actions={<StatusBadge label={t(`agents.storeOrder.mode.${breakdown.mode}`)} tone="info" />}
    >
      <dl className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0"
          >
            <dt className="min-w-0">
              <span
                className={
                  row.emphasis ? "text-caption font-semibold" : "text-caption text-muted-foreground"
                }
              >
                {row.label}
              </span>
              {row.note ? (
                <span className="block text-caption text-muted-foreground">{row.note}</span>
              ) : null}
            </dt>
            <dd className={row.emphasis ? "font-semibold" : undefined}>
              <MoneyValue value={row.value} currency={currency} />
            </dd>
          </div>
        ))}
      </dl>
    </DetailSection>
  );
}

/**
 * Store-order detail additions for agent orders (spec §6): the owner agent,
 * the price breakdown, "no company invoice", and the return receipt
 * (`POST /agent-returns/orders/:orderId`, internal Shipping only).
 */
export function AgentOrderPanel({
  order,
  onChanged,
}: {
  order: StoreOrderRow;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canViewReturns = hasPermission("shipping.view") || hasPermission("shipping.edit");
  const canReceive = hasPermission("shipping.edit");
  const [returns, setReturns] = useState<AgentReturnRow[] | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const canViewFinance = hasPermission("agents.finance.view");
  const canRefund = hasPermission("agents.finance.adjust");

  const loadReturns = useCallback(async () => {
    if (!canViewReturns) return;
    try {
      setReturns(await agentReturnsService.list(order.id));
    } catch {
      setReturns([]);
    }
  }, [canViewReturns, order.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReturns();
  }, [loadReturns]);

  if (!order.agentId) return <OrderPriceBreakdown order={order} />;

  const dispatched = !!order.agentDispatchedAt;
  const refundButton = canRefund ? (
    <EnterpriseButton type="button" size="sm" variant="outline" onClick={() => setRefundOpen(true)}>
      <Undo2 />
      {t("agents.refund.action")}
    </EnterpriseButton>
  ) : null;
  const returnColumns: CompactDetailColumn<AgentReturnRow>[] = [
    {
      id: "number",
      header: t("agents.storeOrder.returnNumber"),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="num">{row.returnNumber}</span>
          <span className="text-caption text-muted-foreground">{formatDate(row.createdAt)}</span>
        </span>
      ),
    },
    {
      id: "qty",
      header: t("agents.storeOrder.returnQuantity"),
      align: "end",
      cell: (row) => (
        <SemanticValue kind="number">
          {(Array.isArray(row.lines) ? row.lines : []).reduce(
            (sum, line) => sum + Number(line.quantity),
            0,
          )}
        </SemanticValue>
      ),
    },
    {
      id: "amount",
      header: t("agents.storeOrder.merchandise"),
      align: "end",
      cell: (row) => <MoneyValue value={row.merchandiseAmount} currency={order.currency} />,
    },
    {
      id: "reason",
      header: t("agents.storeOrder.reason"),
      cell: (row) => row.reason ?? "—",
    },
  ];

  return (
    <>
      <Alert tone="info">
        <Info />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <AgentBadge agent={order.agent} />
          <span>{t("agents.storeOrder.noInvoice")}</span>
        </AlertDescription>
      </Alert>
      <OrderPriceBreakdown order={order} />
      {canViewFinance || canRefund ? (
        canViewFinance ? (
          <AgentPaymentStages
            agentId={order.agentId}
            storeOrderId={order.id}
            refreshKey={order.updatedAt}
            actions={refundButton}
          />
        ) : (
          <div>{refundButton}</div>
        )
      ) : null}
      {canViewReturns ? (
        <DetailSection
          title={t("agents.storeOrder.returnsTitle")}
          actions={
            canReceive && dispatched ? (
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReceiveOpen(true)}
              >
                <PackageOpen />
                {t("agents.storeOrder.receiveReturn")}
              </EnterpriseButton>
            ) : null
          }
        >
          <CompactDetailTable
            columns={returnColumns}
            rows={returns ?? []}
            rowKey={(row) => row.id}
            empty={returns ? t("common.noResults") : t("common.loading")}
          />
        </DetailSection>
      ) : null}
      {refundOpen ? (
        <RecordRefundDialog
          orderId={order.id}
          orderNumber={order.internalOrderId}
          currency={order.currency?.code ?? ""}
          onOpenChange={setRefundOpen}
          onRecorded={onChanged}
        />
      ) : null}
      {receiveOpen ? (
        <ReceiveReturnDialog
          order={order}
          returns={returns ?? []}
          onOpenChange={setReceiveOpen}
          onReceived={() => {
            void loadReturns();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function ReceiveReturnDialog({
  order,
  returns,
  onOpenChange,
  onReceived,
}: {
  order: StoreOrderRow;
  returns: AgentReturnRow[];
  onOpenChange: (open: boolean) => void;
  onReceived: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  // One key per dialog open: a retry or double click records one return.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [warehouse, setWarehouse] = useState<WarehouseRow | null>(null);
  const [reason, setReason] = useState("");
  const shipmentChoices = returnShipmentChoices(order.shipments ?? []);
  const [shipmentId, setShipmentId] = useState<string>(() =>
    shipmentChoices.length === 1 && isReturnShipment(shipmentChoices[0])
      ? shipmentChoices[0].id
      : "",
  );
  const [feeTouched, setFeeTouched] = useState(false);
  const [chargeFee, setChargeFee] = useState(() =>
    defaultChargeReturnFee(shipmentId || null, returns.length),
  );
  const effectiveChargeFee = feeTouched
    ? chargeFee
    : defaultChargeReturnFee(shipmentId || null, returns.length);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const already = returnedQuantities(returns);
  const { lines, errors } = buildReturnLines(order.items, quantities, already);
  const hasErrors = Object.keys(errors).length > 0;

  const submit = async () => {
    if (hasErrors || lines.length === 0 || !warehouse) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      await agentReturnsService.receive(order.id, {
        lines,
        warehouseId: warehouse.id,
        reason: reason.trim() || undefined,
        idempotencyKey,
        ...(shipmentId ? { shipmentId } : {}),
        chargeReturnFee: effectiveChargeFee,
      });
      toast.success(t("agents.storeOrder.returnReceived"));
      onReceived();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const columns: CompactDetailColumn<StoreOrderItemRow>[] = [
    {
      id: "product",
      header: t("agents.stock.product"),
      cell: (item) => item.product?.name ?? item.productId,
    },
    {
      id: "ordered",
      header: t("agents.storeOrder.ordered"),
      align: "end",
      cell: (item) => <SemanticValue kind="number">{item.quantity}</SemanticValue>,
    },
    {
      id: "returned",
      header: t("agents.storeOrder.alreadyReturned"),
      align: "end",
      cell: (item) => <SemanticValue kind="number">{already[item.id] ?? 0}</SemanticValue>,
    },
    {
      id: "qty",
      header: t("agents.storeOrder.returnQuantity"),
      align: "end",
      cell: (item) => (
        <div className="flex flex-col items-end gap-0.5">
          <Input
            dir="ltr"
            inputMode="numeric"
            className="w-20 text-end"
            aria-label={`${t("agents.storeOrder.returnQuantity")} — ${item.product?.name ?? ""}`}
            value={quantities[item.id] ?? ""}
            aria-invalid={!!errors[item.id]}
            onChange={(event) =>
              setQuantities((current) => ({ ...current, [item.id]: event.target.value }))
            }
          />
          {errors[item.id] ? (
            <span className="text-caption text-destructive">
              {t(`agents.storeOrder.returnErrors.${errors[item.id]}`)}
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={t("agents.storeOrder.returnTitle", { order: order.internalOrderId })}
      description={t("agents.storeOrder.returnDescription")}
      isDirty={Object.values(quantities).some(Boolean) || !!reason || !!warehouse}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitLabel={t("agents.storeOrder.receiveReturn")}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agents.storeOrder.returnsTitle")}>
          <CompactDetailTable columns={columns} rows={order.items} rowKey={(item) => item.id} />
          {showErrors && lines.length === 0 && !hasErrors ? (
            <p className="text-caption text-destructive">
              {t("agents.storeOrder.returnErrors.noLines")}
            </p>
          ) : null}
        </FormCardSection>
        <FormCardSection title={t("agents.storeOrder.warehouse")}>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.storeOrder.warehouse")}
              htmlFor={`${fieldId}-warehouse`}
              message={
                <FieldNote
                  error={
                    showErrors && !warehouse
                      ? t("agents.storeOrder.returnErrors.warehouseRequired")
                      : null
                  }
                />
              }
            >
              <WarehousePicker
                id={`${fieldId}-warehouse`}
                value={warehouse}
                onChange={setWarehouse}
                error={showErrors && !warehouse}
              />
            </FormCardField>
            <FormCardField
              size="md"
              label={t("agents.storeOrder.reason")}
              htmlFor={`${fieldId}-reason`}
            >
              <Input
                id={`${fieldId}-reason`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
          {shipmentChoices.length > 0 ? (
            <FormCardField
              label={t("agents.storeOrder.returnShipment")}
              htmlFor={`${fieldId}-shipment`}
              message={<FieldNote hint={t("agents.storeOrder.returnShipmentHint")} />}
            >
              <SearchableSelect
                id={`${fieldId}-shipment`}
                value={shipmentId}
                onValueChange={setShipmentId}
                allowClear
                placeholder={t("agents.storeOrder.returnShipmentNone")}
                options={shipmentChoices.map((shipment) => ({
                  value: shipment.id,
                  label: t("agents.storeOrder.returnShipmentLabel", {
                    number: shipment.attemptNumber,
                  }),
                  description: [
                    shipment.shippingCompany?.name,
                    shipment.trackingNumber,
                    shipment.shippingStatus?.name ?? shipment.status,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))}
              />
            </FormCardField>
          ) : null}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-body select-none">
              <Checkbox
                checked={effectiveChargeFee}
                onCheckedChange={(checked) => {
                  setFeeTouched(true);
                  setChargeFee(checked === true);
                }}
              />
              {t("agents.storeOrder.chargeReturnFee")}
            </label>
            <FieldNote hint={t("agents.storeOrder.chargeReturnFeeHint")} />
          </div>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
