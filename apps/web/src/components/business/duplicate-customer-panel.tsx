"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, ShieldAlert, UserCheck, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseButton } from "@/components/ui/button";
import {
  choiceFits,
  panelMode,
  phoneMatchRecords,
  primaryExistingOrder,
  sortOrdersForPanel,
  type DuplicateChoice,
  type DuplicatePanelState,
} from "@/config/orders/duplicate-panel";
import type {
  DuplicateCheckResult,
  DuplicateOrderSummary,
} from "@/services/order-duplicates-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

const MAX_ORDERS_SHOWN = 5;

/**
 * Round 5 Spec 1B — the inline duplicate warning under a customer's phone
 * field, shared by the store-order create dialog, the lead convert dialog
 * and the agent order form. A phone match lists the orders the user can
 * open with Open existing order / New order for this customer / Edit
 * details; a name-only match is a softer Same customer / Different customer
 * question; a match outside the user's scope says only that. The parent
 * keeps submit disabled until `choice` answers the result
 * (`useDuplicateCheck().blocked`).
 */
export function DuplicateCustomerPanel({
  state,
  onChoose,
  orderHref,
  onEditDetails,
}: {
  state: DuplicatePanelState;
  onChoose: (choice: DuplicateChoice | null) => void;
  /** Where an existing order opens (internal vs agent portal route). */
  orderHref: (orderId: string) => string;
  /** Omitted where the customer details are not editable here (lead conversion). */
  onEditDetails?: () => void;
}) {
  const { t } = useLocale();
  const { result, choice } = state;
  const mode = panelMode(result);

  if (state.status === "failed") {
    return (
      <p className="text-caption text-muted-foreground" role="status">
        {t("orderDuplicates.checkFailed")}
      </p>
    );
  }
  if (mode === "none") {
    return state.status === "checking" ? (
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {t("orderDuplicates.checking")}
      </p>
    ) : null;
  }

  const answered = choiceFits(result, choice);
  const editButton = onEditDetails ? (
    <EnterpriseButton type="button" variant="ghost" size="sm" onClick={onEditDetails}>
      {t("orderDuplicates.phone.editDetails")}
    </EnterpriseButton>
  ) : null;

  if (mode === "known" && result?.kind === "KNOWN") {
    return (
      <Alert tone="info" role="status" data-testid="duplicate-panel" data-mode="known">
        <UserCheck aria-hidden />
        <AlertDescription className="flex flex-col gap-1">
          <AlertTitle>{t("orderDuplicates.known.title")}</AlertTitle>
          <p>
            <bdi className="font-medium">{result.customer.nameMasked}</bdi>
            {result.customer.phoneMasked ? (
              <>
                {" · "}
                <bdi dir="ltr" className="num">
                  {result.customer.phoneMasked}
                </bdi>
              </>
            ) : null}
          </p>
          <p>{t("orderDuplicates.known.description")}</p>
        </AlertDescription>
      </Alert>
    );
  }

  if (mode === "crossScope") {
    return (
      <Alert tone="warning" role="status" data-testid="duplicate-panel">
        <ShieldAlert aria-hidden />
        <AlertDescription className="flex flex-col gap-2">
          <AlertTitle>{t("orderDuplicates.crossScope.title")}</AlertTitle>
          <p>{t("orderDuplicates.crossScope.description")}</p>
          {answered ? (
            <ChosenLine
              text={t("orderDuplicates.crossScope.chosen")}
              onChange={() => onChoose(null)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChoose({ kind: "CONTINUE_WITH_REVIEW" })}
              >
                {t("orderDuplicates.crossScope.continue")}
              </EnterpriseButton>
              {editButton}
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (mode === "name" && result?.kind === "NAME") {
    const chosenCandidate =
      choice?.kind === "SAME_CUSTOMER"
        ? result.candidates.find((candidate) => candidate.id === choice.customerId)
        : undefined;
    return (
      <Alert tone="info" role="status" data-testid="duplicate-panel">
        <Users aria-hidden />
        <AlertDescription className="flex flex-col gap-2">
          <AlertTitle>{t("orderDuplicates.name.title")}</AlertTitle>
          {answered ? (
            <ChosenLine
              text={
                chosenCandidate
                  ? t("orderDuplicates.name.chosenSame", { name: chosenCandidate.name })
                  : t("orderDuplicates.name.chosenDifferent")
              }
              onChange={() => onChoose(null)}
            />
          ) : (
            <>
              <p>{t("orderDuplicates.name.description")}</p>
              <ul className="flex flex-col divide-y divide-border rounded-sm border border-border bg-card">
                {result.candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5"
                  >
                    <span className="flex min-w-0 flex-col">
                      <bdi className="truncate font-medium text-foreground">{candidate.name}</bdi>
                      <span className="text-muted-foreground">
                        {candidate.phoneMasked ? (
                          <bdi dir="ltr" className="num">
                            {candidate.phoneMasked}
                          </bdi>
                        ) : null}
                        {candidate.phoneMasked && candidate.orderCount != null ? " · " : null}
                        {candidate.orderCount != null
                          ? t("orderDuplicates.name.candidate", {
                              count: candidate.orderCount,
                              date: formatDate(candidate.lastOrderDate),
                            })
                          : null}
                      </span>
                    </span>
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onChoose({ kind: "SAME_CUSTOMER", customerId: candidate.id })}
                    >
                      {t("orderDuplicates.name.same")}
                    </EnterpriseButton>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChoose({ kind: "DIFFERENT_CUSTOMER" })}
                >
                  {t("orderDuplicates.name.different")}
                </EnterpriseButton>
              </div>
            </>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const match = result as Extract<DuplicateCheckResult, { kind: "PHONE"; crossScope: false }>;
  const orders = sortOrdersForPanel(match.orders).slice(0, MAX_ORDERS_SHOWN);
  const primary = primaryExistingOrder(match);
  const records = phoneMatchRecords(match);
  const ambiguous = records.length > 1;
  const chosenRecord =
    choice?.kind === "NEW_ORDER"
      ? records.find((record) => record.id === choice.customerId)
      : undefined;
  return (
    <Alert tone="warning" role="status" data-testid="duplicate-panel" data-mode="phone">
      <UserCheck aria-hidden />
      <AlertDescription className="flex flex-col gap-2">
        <AlertTitle>{t("orderDuplicates.phone.title")}</AlertTitle>
        <p>
          <bdi className="font-medium">{match.customer.name}</bdi>
          {match.customer.phoneMasked ? (
            <>
              {" · "}
              <bdi dir="ltr" className="num">
                {match.customer.phoneMasked}
              </bdi>
            </>
          ) : null}
        </p>
        {orders.length > 0 ? (
          <p className="font-medium">
            {t("orderDuplicates.phone.hasOrders", { count: match.orders.length })}
          </p>
        ) : null}
        {orders.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-sm border border-border bg-card">
            {orders.map((order) => (
              <ExistingOrderRow key={order.id} order={order} href={orderHref(order.id)} />
            ))}
          </ul>
        ) : (
          <p>{t("orderDuplicates.phone.noOpenable")}</p>
        )}
        {match.otherOrdersCount > 0 && orders.length > 0 ? (
          <p className="text-muted-foreground">
            {t("orderDuplicates.phone.otherOrders", { count: match.otherOrdersCount })}
          </p>
        ) : null}
        {answered ? (
          <ChosenLine
            text={t("orderDuplicates.phone.chosen", {
              name: chosenRecord?.name ?? match.customer.name,
            })}
            onChange={() => onChoose(null)}
          />
        ) : ambiguous ? (
          <div className="flex flex-col gap-2" data-testid="duplicate-records">
            <p>{t("orderDuplicates.phone.whichRecord")}</p>
            <ul className="flex flex-col divide-y divide-border rounded-sm border border-border bg-card">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5"
                >
                  <span className="flex min-w-0 flex-col">
                    <bdi className="truncate font-medium text-foreground">{record.name}</bdi>
                    {record.phoneMasked ? (
                      <bdi dir="ltr" className="num text-muted-foreground">
                        {record.phoneMasked}
                      </bdi>
                    ) : null}
                  </span>
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChoose({ kind: "NEW_ORDER", customerId: record.id })}
                  >
                    {t("orderDuplicates.phone.useRecord")}
                  </EnterpriseButton>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {primary ? (
                <EnterpriseButton asChild variant="outline" size="sm">
                  <Link href={orderHref(primary.id)}>
                    <ExternalLink aria-hidden />
                    {t("orderDuplicates.phone.openExisting")}
                  </Link>
                </EnterpriseButton>
              ) : null}
              {editButton}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {primary ? (
              <EnterpriseButton asChild variant="outline" size="sm">
                <Link href={orderHref(primary.id)}>
                  <ExternalLink aria-hidden />
                  {t("orderDuplicates.phone.openExisting")}
                </Link>
              </EnterpriseButton>
            ) : null}
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChoose({ kind: "NEW_ORDER", customerId: match.customer.id })}
            >
              {t("orderDuplicates.phone.newOrder")}
            </EnterpriseButton>
            {editButton}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

function ExistingOrderRow({ order, href }: { order: DuplicateOrderSummary; href: string }) {
  const { t, locale } = useLocale();
  const status = order.fulfillmentStatus
    ? locale === "en"
      ? (order.fulfillmentStatus.nameEn ?? order.fulfillmentStatus.name)
      : order.fulfillmentStatus.name
    : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-1.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link href={href} className="num font-medium text-(--link) hover:underline" dir="ltr">
          {order.orderNumber}
        </Link>
        <span className="text-muted-foreground">{formatDate(order.orderDate)}</span>
        {status ? <span className="text-muted-foreground">{status}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <EnterpriseBadge variant={order.active ? "info" : "secondary"}>
          {order.active ? t("orderDuplicates.phone.active") : t("orderDuplicates.phone.closed")}
        </EnterpriseBadge>
        <span dir="ltr" className="num text-foreground">
          {formatMoney(order.total, order.currencyCode)}
        </span>
      </span>
    </li>
  );
}

function ChosenLine({ text, onChange }: { text: string; onChange: () => void }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
        {text}
      </span>
      <EnterpriseButton type="button" variant="ghost" size="sm" onClick={onChange}>
        {t("orderDuplicates.change")}
      </EnterpriseButton>
    </div>
  );
}
