"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PenLine, Wallet } from "lucide-react";
import {
  CollapsibleDetailSection,
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailSummaryBar,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { OrderAmendDialog } from "@/components/store-orders/order-amend-dialog";
import { OrderAmendmentHistory } from "@/components/store-orders/order-amendment-history";
import { amendableFromPortalOrder } from "@/config/store-orders/amendment-draft";
import type { AmendmentHistoryRow } from "@/services/order-amendments-service";
import type { SearchableSelectOption } from "@/components/shared/searchable-select";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { PageLoading } from "@/components/shared/page-loading";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { WorkflowTracker } from "@/components/shared/workflow-tracker";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { StatusBadge } from "@/components/business/status-badge";
import { OrderBreakdown } from "@/components/agent-portal/order-breakdown";
import { ShippingPricingNotice } from "@/components/agents/shipping-pricing-panel";
import { PortalFileList } from "@/components/agent-portal/portal-files";
import { DeclarePaymentDialog } from "@/components/agent-portal/declare-payment-dialog";
import {
  DeclaredStatusBadge,
  FinanceStatusBadge,
  FulfillmentStatusBadge,
  OwnershipBadge,
  PaymentStageBadge,
  VerificationBadge,
} from "@/components/agent-portal/portal-badges";
import {
  DIGITAL_FULFILLMENT_STAGE_KEYS,
  FULFILLMENT_STAGE_KEYS,
  cancelledTrackerState,
  digitalFulfillmentState,
  fulfillmentProgress,
  localizedName,
} from "@/config/agent-portal/labels";
import { agentPortalService, type PortalOrderDetail } from "@/services/agent-portal-service";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, formatDateTime } from "@/lib/date";
import { apiErrorMessage, reportApiError, reportSuccess } from "@/lib/toast";
import { formatMoney } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";

type Line = PortalOrderDetail["lines"][number];
type Shipment = PortalOrderDetail["fulfillment"]["shipments"][number];
type Return = PortalOrderDetail["returns"][number];

/**
 * Agent order detail (spec §6–§7): breakdown, lines, fulfillment progress
 * with shipments, the payment section that keeps "declared by sales" apart
 * from "verified by Finance" per claim, proof files, returns and a
 * business-event timeline. The only action is the agent's own payment
 * declaration — no ship / verify / settle controls exist in the portal.
 */
export default function AgentOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useLocale();
  const { hasPermission, user } = useUserContext();
  const [order, setOrder] = useState<PortalOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declareOpen, setDeclareOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendments, setAmendments] = useState<AmendmentHistoryRow[] | null>(null);
  const [countries, setCountries] = useState<SearchableSelectOption[]>([]);
  // Spec 1C — secondary sections collapsed by default, remembered per user.
  const [openSections, setOpenSections] = useLocalStorage<Record<string, boolean>>(
    `oms.orderDetail.${user?.id ?? "anonymous"}.agentOrder.openSections`,
    {},
  );
  const sectionProps = (key: string) => ({
    open: openSections[key] === true,
    onOpenChange: (open: boolean) => setOpenSections((prev) => ({ ...prev, [key]: open })),
  });

  useBreadcrumbLabel(order?.internalOrderId ?? null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrder(await agentPortalService.orders.get(id));
      agentPortalService.orders.amendments
        .history(id)
        .then(setAmendments)
        .catch(() => setAmendments([]));
    } catch (err) {
      setError(apiErrorMessage(err, "agentPortal.common.loadFailed"));
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!order) return <PageLoading />;

  const currency = order.currency;
  const cancelled = order.fulfillment.status?.code === "CANCELLED";
  const canDeclare = hasPermission("agent.payments.declare") && !cancelled;
  // Spec 1A — amend until delivery (the server decides what the agent may change).
  const canAmend =
    hasPermission("agent.orders.edit") && !cancelled && !order.fulfillment.dispatchedAt;
  const openAmend = () => {
    setAmendOpen(true);
    agentPortalService
      .countries()
      .then((rows) =>
        setCountries(
          rows.map((country) => ({ value: country.id, label: localizedName(country, locale) })),
        ),
      )
      .catch(() => setCountries([]));
  };
  const searchProducts = async (query: string): Promise<SearchableSelectOption[]> => {
    const page = await agentPortalService.products({
      search: query.trim() || undefined,
      pageSize: 50,
    });
    return page.items.map((product) => ({
      value: product.id,
      label: localizedName(product, locale),
      description: product.sku,
    }));
  };
  // Spec 2 — the order owner / agent admin records the customer's agreement.
  const canConfirmTotal = hasPermission("agent.orders.create") && !cancelled;
  const confirmCustomerTotal = async (expectedPayableTotal: number) => {
    try {
      setOrder(
        await agentPortalService.orders.confirmCustomerTotal(order.id, expectedPayableTotal),
      );
      reportSuccess(
        t("agentPricing.customerTotal.confirmed", {
          total: formatMoney(expectedPayableTotal, currency?.code ?? null),
        }),
      );
    } catch (err) {
      reportApiError(err, "common.failedToSave");
    }
  };
  const progress = fulfillmentProgress({
    dispatchedAt: order.fulfillment.dispatchedAt,
    earnedAt: order.fulfillment.earnedAt,
    statusCode: order.fulfillment.status?.code,
  });
  const digitalOnly = order.fulfillment.digitalOnly === true;
  const digitalState = digitalOnly
    ? digitalFulfillmentState({
        earnedAt: order.fulfillment.earnedAt,
        statusCode: order.fulfillment.status?.code,
      })
    : null;
  const stageKeys = digitalOnly ? DIGITAL_FULFILLMENT_STAGE_KEYS : FULFILLMENT_STAGE_KEYS;
  const stageDates: Record<string, string | null> = {
    created: order.createdAt,
    dispatched: order.fulfillment.dispatchedAt,
    completed: order.fulfillment.earnedAt,
  };

  const lineColumns: CompactDetailColumn<Line>[] = [
    {
      id: "product",
      header: t("agentPortal.orderDetail.lines.product"),
      cell: (line) => (
        <StackedCell
          primary={localizedName(line.product, locale)}
          secondary={<SemanticValue kind="id">{line.product.sku}</SemanticValue>}
        />
      ),
    },
    {
      id: "qty",
      header: t("agentPortal.orderDetail.lines.quantity"),
      align: "end",
      cell: (line) => <span className="num">{line.quantity}</span>,
    },
    {
      id: "unit",
      header: t("agentPortal.orderDetail.lines.unitPrice"),
      align: "end",
      cell: (line) => <MoneyValue value={line.unitPrice} currency={currency} />,
    },
    {
      id: "amount",
      header: t("agentPortal.orderDetail.lines.amount"),
      align: "end",
      cell: (line) => <MoneyValue value={line.lineAmount} currency={currency} />,
    },
  ];

  const shipmentColumns: CompactDetailColumn<Shipment>[] = [
    {
      id: "attempt",
      header: t("agentPortal.orderDetail.shipment.status"),
      cell: (s) => (
        <StackedCell
          primary={t("agentPortal.orderDetail.shipment.attempt", { number: s.attemptNumber })}
          secondary={s.isReship ? t("agentPortal.orderDetail.shipment.reship") : undefined}
        />
      ),
    },
    {
      id: "carrier",
      header: t("agentPortal.orderDetail.shipment.carrier"),
      cell: (s) =>
        s.carrierStatus ? (
          <StackedCell
            primary={s.shippingCompany?.name ?? "—"}
            secondary={
              <StatusBadge label={s.carrierStatus.name} colorKey={s.carrierStatus.color} />
            }
          />
        ) : (
          (s.shippingCompany?.name ?? "—")
        ),
    },
    {
      id: "tracking",
      header: t("agentPortal.orderDetail.shipment.tracking"),
      cell: (s) =>
        s.trackingNumber ? <SemanticValue kind="id">{s.trackingNumber}</SemanticValue> : "—",
    },
    {
      id: "updated",
      header: t("agentPortal.orderDetail.shipment.updated"),
      cell: (s) => <span className="num">{formatDateTime(s.updatedAt)}</span>,
    },
  ];

  const returnColumns: CompactDetailColumn<Return>[] = [
    {
      id: "number",
      header: t("agentPortal.orderDetail.returns.number"),
      cell: (r) => <SemanticValue kind="id">{r.returnNumber}</SemanticValue>,
    },
    {
      id: "date",
      header: t("agentPortal.orderDetail.returns.date"),
      cell: (r) => <span className="num">{formatDate(r.createdAt)}</span>,
    },
    {
      id: "amount",
      header: t("agentPortal.orderDetail.returns.amount"),
      align: "end",
      cell: (r) => <MoneyValue value={r.merchandiseAmount} currency={currency} />,
    },
    {
      id: "reason",
      header: t("agentPortal.orderDetail.returns.reason"),
      cell: (r) => r.reason ?? "—",
    },
  ];

  return (
    <DetailWorkspace
      title={order.customer?.name ?? order.internalOrderId}
      reference={order.internalOrderId}
      meta={
        <>
          {formatDate(order.orderDate)}
          {order.lead ? (
            <>
              {" · "}
              {t("agentPortal.orderDetail.lead", { number: order.lead.leadNumber })}
            </>
          ) : null}
        </>
      }
      status={
        digitalState ? (
          <StatusBadge label={t(digitalState.labelKey)} tone={digitalState.tone} />
        ) : (
          <FulfillmentStatusBadge status={order.fulfillment.status} />
        )
      }
      actions={
        <HeaderActions
          primary={{
            key: "declare",
            label: t("agentPortal.declare.action"),
            icon: Wallet,
            hidden: !canDeclare,
            onSelect: () => setDeclareOpen(true),
          }}
          secondary={[
            {
              key: "amend",
              label: t("orderAmendments.action"),
              icon: PenLine,
              testId: "order-amend",
              hidden: !canAmend,
              onSelect: openAmend,
            },
          ]}
        />
      }
    >
      <DetailSummaryBar>
        <DetailField
          label={t("agentPortal.orders.fields.payable")}
          value={<MoneyValue value={order.breakdown.payableTotal} currency={currency} />}
        />
        <DetailField
          label={t("agentPortal.orders.fields.declared")}
          value={<DeclaredStatusBadge status={order.payment.declaredPaymentStatus} />}
        />
        <DetailField
          label={t("agentPortal.orders.fields.finance")}
          value={<FinanceStatusBadge status={order.payment.financePaymentStatus} />}
        />
        <DetailField
          label={t("agentPortal.orders.fields.method")}
          value={t(`agentPortal.status.method.${order.fulfillmentMethod}`)}
        />
        <DetailField
          label={t("agentPortal.orders.fields.paymentType")}
          value={t(`agentPortal.status.paymentType.${order.paymentType}`)}
        />
        <DetailField label={t("agentPortal.orders.fields.owner")} value={order.owner?.fullName} />
      </DetailSummaryBar>

      <ShippingPricingNotice
        pricing={order.shippingPricing}
        currency={currency}
        canConfirm={canConfirmTotal}
        onConfirm={confirmCustomerTotal}
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <DetailSection title={t("agentPortal.orderDetail.linesTitle")}>
            <CompactDetailTable
              columns={lineColumns}
              rows={order.lines}
              rowKey={(line) => line.id}
              stacked
            />
          </DetailSection>

          <DetailSection title={t("agentPortal.orderDetail.fulfillmentTitle")}>
            <WorkflowTracker
              label={t("agentPortal.orderDetail.progress.label")}
              stages={stageKeys.map((key) => ({
                key,
                label: t(`agentPortal.orderDetail.progress.${key}`),
                caption: stageDates[key] ? formatDate(stageDates[key]) : null,
              }))}
              current={progress.current}
              currentComplete={progress.complete}
              state={
                progress.cancelled
                  ? cancelledTrackerState(t("agentPortal.orderDetail.progress.cancelled"))
                  : null
              }
            />
            {digitalOnly ? (
              <p className="text-caption text-muted-foreground">
                {t("agentPortal.orderDetail.digital.note")}
              </p>
            ) : order.fulfillmentMethod === "SHIPPING" ? (
              order.fulfillment.shipments.length > 0 ? (
                <CompactDetailTable
                  columns={shipmentColumns}
                  rows={order.fulfillment.shipments}
                  rowKey={(s) => s.id}
                  stacked
                />
              ) : (
                <p className="text-caption text-muted-foreground">
                  {t("agentPortal.orderDetail.shipmentsEmpty")}
                </p>
              )
            ) : null}
          </DetailSection>

          <CollapsibleDetailSection
            title={t("orderAmendments.detail.sections.payments")}
            summary={t("orderAmendments.detail.summary.payments", {
              count: order.payment.claims.length,
            })}
            {...sectionProps("payments")}
          >
            <DetailFieldGrid columns={4}>
              <DetailField
                label={t("agentPortal.orderDetail.payment.declaredAmount")}
                value={<MoneyValue value={order.payment.declaredAmount} currency={currency} />}
              />
              <DetailField
                label={t("agentPortal.orderDetail.payment.verifiedAmount")}
                value={
                  <MoneyValue value={order.payment.financeVerifiedAmount} currency={currency} />
                }
              />
              {order.payment.financeMatchedAmount > 0 ? (
                <DetailField
                  label={t("agentPortal.orderDetail.payment.matchedAmount")}
                  value={
                    <MoneyValue value={order.payment.financeMatchedAmount} currency={currency} />
                  }
                />
              ) : null}
              <DetailField
                label={t("agentPortal.orderDetail.payment.remaining")}
                value={<MoneyValue value={order.payment.remainingToDeclare} currency={currency} />}
              />
            </DetailFieldGrid>
            {order.payment.paymentDiscrepancy ? (
              <p className="rounded-sm bg-warning-soft px-2 py-1.5 text-caption text-warning-soft-foreground">
                {t("agentPortal.orderDetail.payment.discrepancy")}
                {order.payment.paymentDiscrepancyReason
                  ? ` — ${order.payment.paymentDiscrepancyReason}`
                  : ""}
              </p>
            ) : null}
            {order.payment.claims.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("agentPortal.orderDetail.claimsEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {order.payment.claims.map((claim) => (
                  <li
                    key={claim.id}
                    className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-body font-medium">
                          {t("agentPortal.orderDetail.payment.claim", {
                            number: claim.paymentNumber,
                          })}
                        </span>
                        <MoneyValue value={claim.amount} currency={claim.currencyCode} />
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <VerificationBadge verification={claim.verification} />
                        {claim.stage && claim.stage !== "DECLARED" && claim.stage !== "REJECTED" ? (
                          <PaymentStageBadge stage={claim.stage} />
                        ) : null}
                      </span>
                    </div>
                    <DetailFieldGrid columns={4}>
                      <DetailField
                        label={t("agentPortal.orderDetail.payment.destination")}
                        value={
                          claim.destination ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              {claim.destination.label}
                              <OwnershipBadge ownership={claim.destination.ownership} />
                            </span>
                          ) : claim.ownership ? (
                            <OwnershipBadge ownership={claim.ownership} />
                          ) : null
                        }
                      />
                      <DetailField
                        label={t("agentPortal.orderDetail.payment.method")}
                        value={claim.method?.name}
                      />
                      <DetailField
                        label={t("agentPortal.orderDetail.payment.paymentDate")}
                        value={<span className="num">{formatDate(claim.paymentDate)}</span>}
                      />
                      <DetailField
                        label={t("agentPortal.orderDetail.payment.reference")}
                        value={
                          claim.reference ? (
                            <SemanticValue kind="id">{claim.reference}</SemanticValue>
                          ) : null
                        }
                      />
                      <DetailField
                        label={t("agentPortal.orderDetail.payment.rejection")}
                        value={claim.rejectionReason}
                        className="sm:col-span-2"
                      />
                    </DetailFieldGrid>
                    <PortalFileList
                      files={claim.attachments}
                      emptyText={t("agentPortal.orderDetail.payment.noProof")}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleDetailSection>

          <DetailSection title={t("agentPortal.orderDetail.returnsTitle")}>
            {order.returns.length > 0 ? (
              <CompactDetailTable
                columns={returnColumns}
                rows={order.returns}
                rowKey={(r) => r.id}
                stacked
              />
            ) : (
              <p className="text-caption text-muted-foreground">
                {t("agentPortal.orderDetail.returnsEmpty")}
              </p>
            )}
          </DetailSection>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <DetailSection title={t("agentPortal.orderDetail.breakdownTitle")}>
            <OrderBreakdown
              figures={order.breakdown}
              currency={currency}
              shippingSource={order.breakdown.shippingChargeSource ?? null}
              shippingRate={order.breakdown.shippingRateAmount ?? null}
              provisional={order.shippingPricing.status === "PENDING_METHOD"}
              mode={order.breakdown.mode}
            />
            {order.breakdown.shippingOverrideReason ? (
              <p className="text-caption text-muted-foreground">
                {t("agentPortal.common.reason")}: {order.breakdown.shippingOverrideReason}
              </p>
            ) : null}
          </DetailSection>

          <DetailSection title={t("agentPortal.orderDetail.customerTitle")}>
            {order.customer ? (
              <DetailFieldGrid className="sm:grid-cols-1">
                <DetailField
                  label={t("agentPortal.orderForm.fields.customerName")}
                  value={order.customer.name}
                />
                <DetailField
                  label={t("agentPortal.orderForm.fields.mobile")}
                  value={
                    order.customer.mobile ? (
                      <SemanticValue kind="phone">{order.customer.mobile}</SemanticValue>
                    ) : null
                  }
                />
                <DetailField
                  label={t("agentPortal.orderForm.fields.address")}
                  value={[
                    localizedName(order.customer.country, locale),
                    order.customer.city,
                    order.customer.address,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </DetailFieldGrid>
            ) : (
              <EmptyState title="—" />
            )}
            {order.lead ? (
              <Link
                href={`/agent/leads/${order.lead.id}`}
                className="text-caption text-primary hover:underline"
              >
                {t("agentPortal.orderDetail.lead", { number: order.lead.leadNumber })}
              </Link>
            ) : null}
          </DetailSection>

          <CollapsibleDetailSection
            title={t("orderAmendments.detail.sections.history")}
            summary={t("orderAmendments.detail.summary.history", {
              count: amendments?.length ?? 0,
            })}
            {...sectionProps("history")}
          >
            <OrderAmendmentHistory rows={amendments} />
            <ol className="flex flex-col gap-2">
              {order.timeline.map((event, index) => (
                <li
                  key={`${event.event}-${index}`}
                  className="flex flex-col border-s-2 border-border ps-2"
                >
                  <span className="text-body">
                    {t(`agentPortal.orderDetail.timeline.${event.event}` as MessageKey)}
                    {event.reference ? (
                      <span className="num ms-1 text-muted-foreground" dir="ltr">
                        {event.reference}
                      </span>
                    ) : null}
                  </span>
                  <span className="num text-caption text-muted-foreground">
                    {formatDateTime(event.at)}
                  </span>
                </li>
              ))}
            </ol>
          </CollapsibleDetailSection>
        </div>
      </div>

      <OrderAmendDialog
        order={amendableFromPortalOrder(order, (product) => localizedName(product, locale))}
        client={agentPortalService.orders.amendments}
        options={{
          searchProducts,
          countries,
          canSwitchCustomer: false,
          canCorrectIdentity: true,
        }}
        open={amendOpen}
        onOpenChange={setAmendOpen}
        onAmended={(result) => {
          setOrder(result.order);
          agentPortalService.orders.amendments
            .history(order.id)
            .then(setAmendments)
            .catch(() => setAmendments([]));
        }}
        onReload={() => void load()}
      />
      <DeclarePaymentDialog
        order={order}
        open={declareOpen}
        onOpenChange={setDeclareOpen}
        onDeclared={setOrder}
      />
    </DetailWorkspace>
  );
}
