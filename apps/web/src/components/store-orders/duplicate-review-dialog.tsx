"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { FormSection } from "@/components/documents/form-section";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { PageLoading } from "@/components/shared/page-loading";
import { ErrorState } from "@/components/shared/error-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  orderDuplicatesService,
  type DuplicateReviewDecision,
  type DuplicateReviewDetail,
  type DuplicateReviewOrder,
} from "@/services/order-duplicates-service";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage, reportApiError, reportSuccess } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

/**
 * Round 5 Spec 1B — the internal reviewer's dialog for an order flagged by a
 * cross-scope duplicate match (`store-orders.duplicate_review`): both sides
 * side by side, then Confirmed distinct / Confirmed duplicate with a note. A
 * duplicate is cancelled afterwards through the order's normal flow.
 */
export function DuplicateReviewDialog({
  orderId,
  open,
  onOpenChange,
  onResolved,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<DuplicateReviewDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decision, setDecision] = useState<DuplicateReviewDecision>("CONFIRMED_DISTINCT");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setLoadError(null);
    setDecision("CONFIRMED_DISTINCT");
    setNote("");
    orderDuplicatesService
      .reviewDetail(orderId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(apiErrorMessage(error, "orderDuplicates.review.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  const pending = detail?.order.duplicateReviewStatus === "PENDING";

  const save = async () => {
    if (!orderId) return;
    setIsSaving(true);
    try {
      await orderDuplicatesService.resolveReview(orderId, {
        decision,
        note: note.trim() || undefined,
      });
      reportSuccess(
        decision === "CONFIRMED_DUPLICATE"
          ? t("orderDuplicates.review.resolvedDuplicate")
          : t("orderDuplicates.review.resolved"),
        { href: `/store-orders/${orderId}` },
      );
      onOpenChange(false);
      onResolved();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("orderDuplicates.review.title")}
      description={t("orderDuplicates.review.description")}
      isDirty={note.trim().length > 0}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void save()}
          isSubmitting={isSaving}
          submitDisabled={!pending}
          submitLabel={t("orderDuplicates.review.submit")}
        />
      )}
    >
      {loadError ? (
        <ErrorState description={loadError} />
      ) : !detail ? (
        <PageLoading />
      ) : (
        <div className="flex flex-col gap-4">
          <FormSection title={t("orderDuplicates.review.thisOrder")}>
            <ReviewOrderLine
              order={detail.order}
              customerName={detail.order.customer.name}
              phone={detail.order.customer.mobile ?? detail.order.customer.phone}
            />
            {!pending ? (
              <p className="text-caption text-muted-foreground">
                {t(`orderDuplicates.review.status.${detail.order.duplicateReviewStatus}`)}
                {detail.order.reviewedBy
                  ? ` · ${t("orderDuplicates.review.alreadyResolved", {
                      name: detail.order.reviewedBy.fullName,
                      date: formatDate(detail.order.reviewedAt),
                    })}`
                  : null}
              </p>
            ) : null}
          </FormSection>

          <FormSection title={t("orderDuplicates.review.matches")}>
            {detail.matches.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("orderDuplicates.review.noMatches")}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {detail.matches.map((match) => (
                  <li key={match.customer.id} className="flex flex-col gap-1">
                    <p className="text-body">
                      <bdi className="font-medium">{match.customer.name}</bdi>{" "}
                      <span dir="ltr" className="num text-caption text-muted-foreground">
                        {match.customer.partnerNumber}
                      </span>
                    </p>
                    <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
                      {match.orders.map((order) => (
                        <li key={order.id} className="px-2 py-1.5">
                          <ReviewOrderLine order={order} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          {pending ? (
            <FormSection title={t("orderDuplicates.review.decision")}>
              <SegmentedRadioGroup
                value={decision}
                onValueChange={setDecision}
                options={[
                  { value: "CONFIRMED_DISTINCT", label: t("orderDuplicates.review.distinct") },
                  { value: "CONFIRMED_DUPLICATE", label: t("orderDuplicates.review.duplicate") },
                ]}
              />
              {decision === "CONFIRMED_DUPLICATE" ? (
                <Alert tone="info" role="status">
                  <AlertDescription>{t("orderDuplicates.review.duplicateHint")}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="duplicate-review-note">{t("orderDuplicates.review.note")}</Label>
                <Textarea
                  id="duplicate-review-note"
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </FormSection>
          ) : null}
        </div>
      )}
    </EnterpriseModal>
  );
}

function ReviewOrderLine({
  order,
  customerName,
  phone,
}: {
  order: DuplicateReviewOrder;
  customerName?: string;
  phone?: string | null;
}) {
  const { t, locale } = useLocale();
  const status = order.fulfillmentStatus
    ? locale === "en"
      ? (order.fulfillmentStatus.nameEn ?? order.fulfillmentStatus.name)
      : order.fulfillmentStatus.name
    : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link
          href={`/store-orders/${order.id}`}
          className="num font-medium text-(--link) hover:underline"
          dir="ltr"
        >
          {order.orderNumber}
        </Link>
        <span className="text-muted-foreground">{formatDate(order.orderDate)}</span>
        {customerName ? <bdi className="text-foreground">{customerName}</bdi> : null}
        {phone ? (
          <bdi dir="ltr" className="num text-muted-foreground">
            {phone}
          </bdi>
        ) : null}
        {status ? <span className="text-muted-foreground">{status}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <EnterpriseBadge variant={order.agent ? "info" : "secondary"}>
          {order.agent
            ? `${t("orderDuplicates.review.agent")}: ${order.agent.name}`
            : t("orderDuplicates.review.company")}
        </EnterpriseBadge>
        {order.owner ? (
          <span className="text-muted-foreground">
            {t("orderDuplicates.review.owner")}: {order.owner.fullName}
          </span>
        ) : null}
        <span dir="ltr" className="num text-foreground">
          {formatMoney(order.total, order.currencyCode)}
        </span>
      </span>
    </div>
  );
}
