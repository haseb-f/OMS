"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, PackageCheck, PackageOpen, RotateCcw, TriangleAlert, Undo2 } from "lucide-react";
import { DetailFieldRow, DetailGroup, DetailSection } from "@/components/shared/detail-workspace";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { MoneyValue } from "@/components/shared/money-value";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/business/status-badge";
import { CustomerRefundDialog } from "@/components/financial-transactions/customer-refund-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatMoney } from "@/lib/money";
import {
  storeOrderMoneyService,
  type StoreOrderMoney,
  type StoreOrderMoneyInvoice,
  type StoreOrderMoneyPayment,
  type StoreOrderMoneyRefund,
  type StoreOrderReturn,
  type StoreOrderReturnsOverview,
} from "./store-order-money-service";
import {
  canRecordRefund,
  figureGroups,
  hasReturnableLines,
  moneyNotices,
  type FigureRow,
} from "./store-order-money";
import { StoreOrderReturnDialog } from "./store-order-return-dialog";
import { StoreOrderReceiveReturnDialog } from "./store-order-receive-return-dialog";
import { PaymentReverseDialog } from "./payment-reverse-dialog";

type DocumentRow =
  | { key: string; kind: "PAYMENT"; payment: StoreOrderMoneyPayment }
  | { key: string; kind: "SALES_INVOICE"; invoice: StoreOrderMoneyInvoice }
  | { key: string; kind: "SALES_RETURN"; salesReturn: StoreOrderReturn }
  | { key: string; kind: "CUSTOMER_REFUND"; refund: StoreOrderMoneyRefund };

function documentRows(money: StoreOrderMoney, overview: StoreOrderReturnsOverview): DocumentRow[] {
  return [
    ...money.payments.map((payment) => ({
      key: `p-${payment.id}`,
      kind: "PAYMENT" as const,
      payment,
    })),
    ...money.invoices.map((invoice) => ({
      key: `i-${invoice.id}`,
      kind: "SALES_INVOICE" as const,
      invoice,
    })),
    ...overview.returns.map((salesReturn) => ({
      key: `r-${salesReturn.id}`,
      kind: "SALES_RETURN" as const,
      salesReturn,
    })),
    ...money.refunds.map((refund) => ({
      key: `f-${refund.id}`,
      kind: "CUSTOMER_REFUND" as const,
      refund,
    })),
  ];
}

/**
 * R15 W5b — the order "Collection" panel (D15-9 … D15-12): what the customer
 * owes (payable, invoiced per delivered shipment, credited by returns,
 * balance due) and the money (declared claims, carrier COD expected / held,
 * verified collections, awaiting settlement, in the bank, refunded, refund
 * due), each figure backed by the documents listed under it. Actions: return
 * delivered goods, receive & inspect a requested return, record a refund
 * (manual — no gateway), reverse a payment verified in error. Every figure is
 * the API's; the panel never recomputes money.
 */
export function StoreOrderMoneyPanel({
  storeOrderId,
  refreshKey,
  onChanged,
}: {
  storeOrderId: string;
  /** Reload when the order changes elsewhere on the page (e.g. its `updatedAt`). */
  refreshKey?: string | number;
  /** Called after an action here changed the order (so the page reloads its own data). */
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [money, setMoney] = useState<StoreOrderMoney | null>(null);
  const [overview, setOverview] = useState<StoreOrderReturnsOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<StoreOrderReturn | null>(null);
  const [reverseTarget, setReverseTarget] = useState<StoreOrderMoneyPayment | null>(null);

  const canRequestReturn = hasPermission("sales.returns.create");
  const canReceive = hasPermission("sales.returns.confirm");
  const canRefund = hasPermission("sales.refunds.create") && hasPermission("sales.refunds.confirm");
  const canReverse = hasPermission("sales.receipts.reverse");

  const load = useCallback(async () => {
    try {
      const [nextMoney, nextOverview] = await Promise.all([
        storeOrderMoneyService.get(storeOrderId),
        storeOrderMoneyService.returns(storeOrderId),
      ]);
      setMoney(nextMoney);
      setOverview(nextOverview);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // `refreshKey` reloads the panel when the order changed elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeOrderId, refreshKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changed = () => {
    void load();
    onChanged?.();
  };

  if (failed && !money) {
    return <ErrorState title={t("storeOrderMoney.panel.loadFailed")} onRetry={() => void load()} />;
  }
  if (!money || !overview) {
    return <Skeleton className="h-40 w-full" />;
  }

  const currency = money.currency;
  const groups = figureGroups(money.figures);
  const notices = moneyNotices(money);
  const rows = documentRows(money, overview);

  const figureRow = (row: FigureRow) => (
    <DetailFieldRow
      key={row.key}
      label={t(row.labelKey)}
      value={
        <MoneyValue
          value={money.figures[row.key]}
          currency={currency}
          className={row.strong ? "font-semibold" : undefined}
        />
      }
    />
  );

  const columns: CompactDetailColumn<DocumentRow>[] = [
    {
      id: "document",
      header: t("storeOrderMoney.panel.columns.document"),
      cell: (row) => {
        switch (row.kind) {
          case "PAYMENT":
            return (
              <RelatedRecordLink
                kind="PAYMENT"
                id={row.payment.id}
                number={row.payment.paymentNumber}
                status={row.payment.status}
                settlementStatus={row.payment.settlementStatus}
              />
            );
          case "SALES_INVOICE":
            return (
              <RelatedRecordLink
                kind="SALES_INVOICE"
                id={row.invoice.id}
                number={row.invoice.invoiceNumber}
              />
            );
          case "SALES_RETURN":
            return (
              <RelatedRecordLink
                kind="SALES_RETURN"
                id={row.salesReturn.id}
                number={row.salesReturn.returnNumber}
                // Requested / Received is shown in the details; only a cancelled return keeps its status.
                status={row.salesReturn.status === "CANCELLED" ? row.salesReturn.status : undefined}
              />
            );
          case "CUSTOMER_REFUND":
            return (
              <RelatedRecordLink
                kind="CUSTOMER_REFUND"
                id={row.refund.id}
                number={row.refund.transactionNumber}
              />
            );
        }
      },
    },
    {
      id: "details",
      header: t("storeOrderMoney.panel.columns.details"),
      cell: (row) => <DocumentDetails row={row} currencyCode={currency.code} />,
    },
    {
      id: "amount",
      header: t("storeOrderMoney.panel.columns.amount"),
      align: "end",
      cell: (row) => (
        <MoneyValue
          currency={currency}
          value={
            row.kind === "PAYMENT"
              ? row.payment.amount
              : row.kind === "SALES_INVOICE"
                ? row.invoice.grandTotal
                : row.kind === "SALES_RETURN"
                  ? row.salesReturn.grandTotal
                  : row.refund.amount
          }
        />
      ),
    },
    {
      id: "actions",
      header: t("storeOrderMoney.panel.columns.actions"),
      align: "end",
      cell: (row) => {
        if (row.kind === "PAYMENT" && row.payment.status === "VERIFIED" && canReverse) {
          return row.payment.reverseBlock ? (
            <span className="text-caption text-muted-foreground">
              {t(`storeOrderMoney.reverseDialog.blocked.${row.payment.reverseBlock}`)}
            </span>
          ) : (
            <EnterpriseButton
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setReverseTarget(row.payment)}
            >
              <RotateCcw />
              {t("storeOrderMoney.actions.reverse")}
            </EnterpriseButton>
          );
        }
        if (row.kind === "SALES_RETURN" && row.salesReturn.requested && canReceive) {
          return (
            <EnterpriseButton
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setReceiveTarget(row.salesReturn)}
            >
              <PackageCheck />
              {t("storeOrderMoney.actions.receive")}
            </EnterpriseButton>
          );
        }
        return null;
      },
    },
  ];

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      {canRequestReturn && hasReturnableLines(overview) ? (
        <EnterpriseButton
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setReturnOpen(true)}
        >
          <PackageOpen />
          {t("storeOrderMoney.actions.requestReturn")}
        </EnterpriseButton>
      ) : null}
      {canRefund && canRecordRefund(money) ? (
        <EnterpriseButton
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRefundOpen(true)}
        >
          <Undo2 />
          {t("storeOrderMoney.actions.recordRefund")}
        </EnterpriseButton>
      ) : null}
    </div>
  );

  return (
    <DetailSection title={t("storeOrderMoney.panel.title")} actions={actions}>
      {notices.map((notice) => {
        switch (notice) {
          case "REFUND_PENDING":
            return (
              <Alert key={notice} tone="warning">
                <TriangleAlert />
                <div className="flex flex-col gap-0.5">
                  <AlertTitle>
                    {t("storeOrderMoney.refundPending.title", {
                      amount: formatMoney(money.figures.refundDue, currency.code),
                    })}
                  </AlertTitle>
                  <AlertDescription>{t("storeOrderMoney.refundPending.body")}</AlertDescription>
                </div>
              </Alert>
            );
          case "COD_NOT_TRACKED":
            return (
              <Alert key={notice} tone="info">
                <Info />
                <AlertDescription>
                  {t("storeOrderMoney.cod.notTracked", {
                    carrier: money.codCollection.carrierName ?? "—",
                  })}
                </AlertDescription>
              </Alert>
            );
          case "COD_TRACKED":
            return (
              <p key={notice} className="text-caption text-muted-foreground">
                {t("storeOrderMoney.cod.tracked", {
                  carrier: money.codCollection.carrierName ?? "—",
                  method: money.codCollection.methodName ?? "—",
                })}
              </p>
            );
          case "CANCELLED":
            return (
              <p key={notice} className="text-caption text-muted-foreground">
                {t("storeOrderMoney.panel.cancelled")}
              </p>
            );
        }
      })}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <DetailGroup title={t("storeOrderMoney.panel.orderGroup")}>
          {groups.owed.map(figureRow)}
        </DetailGroup>
        <DetailGroup title={t("storeOrderMoney.panel.moneyGroup")}>
          {groups.received.map(figureRow)}
        </DetailGroup>
      </div>
      <CompactDetailTable
        stacked
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        empty={t("storeOrderMoney.panel.noDocuments")}
      />

      {returnOpen ? (
        <StoreOrderReturnDialog
          orderNumber={money.internalOrderId}
          overview={overview}
          onOpenChange={setReturnOpen}
          onRequested={changed}
        />
      ) : null}
      {receiveTarget ? (
        <StoreOrderReceiveReturnDialog
          storeOrderId={storeOrderId}
          salesReturn={receiveTarget}
          onOpenChange={(open) => !open && setReceiveTarget(null)}
          onReceived={changed}
        />
      ) : null}
      {refundOpen ? (
        <CustomerRefundDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          target={{
            kind: "order",
            storeOrderId,
            orderNumber: money.internalOrderId,
          }}
          currencyCode={currency.code}
          onRefunded={changed}
        />
      ) : null}
      {reverseTarget ? (
        <PaymentReverseDialog
          payment={reverseTarget}
          onOpenChange={(open) => !open && setReverseTarget(null)}
          onReversed={changed}
        />
      ) : null}
    </DetailSection>
  );
}

/** The second line of a document: what it is for and where it stands. */
function DocumentDetails({ row, currencyCode }: { row: DocumentRow; currencyCode: string }) {
  const { t } = useLocale();
  switch (row.kind) {
    case "PAYMENT": {
      const { payment } = row;
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption">
            {payment.origin === "CARRIER_COD"
              ? t("storeOrderMoney.panel.carrierCod")
              : (payment.method?.name ?? "—")}
          </span>
          {payment.receipt ? (
            <RelatedRecordLink
              kind="CUSTOMER_RECEIPT"
              id={payment.receipt.id}
              number={payment.receipt.transactionNumber}
              status={payment.receipt.status}
              variant="inline"
            />
          ) : null}
          {payment.reversalReason ? (
            <span className="text-caption text-muted-foreground">
              {t("storeOrderMoney.panel.reversedReason", { reason: payment.reversalReason })}
            </span>
          ) : null}
        </span>
      );
    }
    case "SALES_INVOICE":
      return row.invoice.shipment ? (
        <span className="text-caption">
          {t("storeOrderMoney.panel.shipment", { number: row.invoice.shipment.attemptNumber })}
          {row.invoice.shipment.trackingNumber ? (
            <span className="block text-muted-foreground">
              {t("storeOrderMoney.panel.tracking", {
                tracking: row.invoice.shipment.trackingNumber,
              })}
            </span>
          ) : null}
        </span>
      ) : null;
    case "SALES_RETURN":
      return (
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          {row.salesReturn.status === "CANCELLED" ? null : (
            <StatusBadge
              label={
                row.salesReturn.requested
                  ? t("storeOrderMoney.panel.returnRequested")
                  : t("storeOrderMoney.panel.returnReceived")
              }
              tone={row.salesReturn.requested ? "warning" : "success"}
            />
          )}
          {row.salesReturn.reason ? (
            <span className="text-caption text-muted-foreground">{row.salesReturn.reason}</span>
          ) : null}
        </span>
      );
    case "CUSTOMER_REFUND":
      return (
        <span className="flex min-w-0 flex-col gap-0.5 text-caption">
          {row.refund.referenceNumber ? <span dir="ltr">{row.refund.referenceNumber}</span> : null}
          <span className="text-muted-foreground">
            {row.refund.againstReturns > 0
              ? t("storeOrderMoney.panel.againstReturns", {
                  amount: formatMoney(row.refund.againstReturns, currencyCode),
                })
              : t("storeOrderMoney.panel.advance")}
          </span>
        </span>
      );
  }
}
