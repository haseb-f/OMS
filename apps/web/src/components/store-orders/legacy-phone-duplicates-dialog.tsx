"use client";

import { useEffect, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { PageLoading } from "@/components/shared/page-loading";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseBadge } from "@/components/ui/badge";
import {
  orderDuplicatesService,
  type LegacyPhoneDuplicateGroup,
} from "@/services/order-duplicates-service";
import { formatPhoneForDisplay } from "@/services/phone-service";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage } from "@/lib/toast";
import { formatDate } from "@/lib/date";

/**
 * Owner decision O3 — read-only report of customers that share a phone
 * number (records created before one phone = one customer). The record
 * holding the phone key is where new orders attach; nothing is merged
 * automatically (`store-orders.duplicate_review`).
 */
export function LegacyPhoneDuplicatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const [groups, setGroups] = useState<LegacyPhoneDuplicateGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(null);
    setLoadError(null);
    orderDuplicatesService
      .phoneGroups()
      .then((result) => {
        if (!cancelled) setGroups(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(apiErrorMessage(error, "orderDuplicates.review.legacy.loadFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("orderDuplicates.review.legacy.title")}
      description={t("orderDuplicates.review.legacy.description")}
    >
      {loadError ? (
        <ErrorState description={loadError} />
      ) : !groups ? (
        <PageLoading />
      ) : groups.length === 0 ? (
        <EmptyState title={t("orderDuplicates.review.legacy.empty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.phone} className="flex flex-col gap-1">
              <bdi dir="ltr" className="num text-body font-medium">
                {formatPhoneForDisplay(group.phone)}
              </bdi>
              <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
                {group.partners.map((partner, index) => (
                  <li
                    key={partner.id ?? `internal-${index}`}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-1.5 text-caption"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      {partner.internalRecord ? (
                        <span className="text-muted-foreground">
                          {t("orderDuplicates.review.legacy.internalRecord")}
                        </span>
                      ) : (
                        <>
                          <bdi className="text-foreground">{partner.name}</bdi>
                          <span dir="ltr" className="num text-muted-foreground">
                            {partner.partnerNumber}
                          </span>
                        </>
                      )}
                      <span className="text-muted-foreground">{formatDate(partner.createdAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {t("orderDuplicates.review.legacy.orders", { count: partner.orderCount })}
                      </span>
                      {partner.keyOwner ? (
                        <EnterpriseBadge variant="info">
                          {t("orderDuplicates.review.legacy.current")}
                        </EnterpriseBadge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </EnterpriseModal>
  );
}
