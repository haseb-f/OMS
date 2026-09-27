"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ChevronRight } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/business/status-badge";
import {
  EnterpriseCard,
  EnterpriseCardAction,
  EnterpriseCardContent,
  EnterpriseCardDescription,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import {
  paymentReconciliationService,
  type ReconciliationMethod,
} from "@/services/payment-reconciliation-service";
import { MethodSummaryStrip } from "./reconciliation-workspace";

/** `/finance/payment-reconciliation` — one card per reconciliation-enabled method (no provider-specific pages). */
export function ReconciliationMethods() {
  const { t } = useLocale();
  const [methods, setMethods] = useState<ReconciliationMethod[] | null>(null);

  const load = useCallback(async () => {
    try {
      setMethods(await paymentReconciliationService.listMethods());
    } catch (error) {
      setMethods([]);
      reportApiError(error, t("common.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <PageWorkspace
      title={t("paymentReconciliation.title")}
      description={t("paymentReconciliation.description")}
    >
      {methods === null ? (
        <PageLoading />
      ) : methods.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={t("paymentReconciliation.list.empty")}
          description={t("paymentReconciliation.list.emptyHint")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {methods.map((method) => (
            <Link
              key={method.id}
              href={`/finance/payment-reconciliation/${method.id}`}
              className="min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`${t("paymentReconciliation.list.open")} — ${method.name}`}
            >
              <EnterpriseCard clickable className="h-full">
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle className="flex items-center gap-2">
                    {method.name}
                    {!method.isActive ? (
                      <StatusBadge
                        label={t("paymentReconciliation.list.inactive")}
                        tone="neutral"
                      />
                    ) : null}
                    {(method.summary?.lines.EXCEPTION ?? 0) > 0 ? (
                      <StatusBadge
                        label={`${t("paymentReconciliation.list.exceptions")}: ${method.summary?.lines.EXCEPTION}`}
                        tone="destructive"
                      />
                    ) : null}
                  </EnterpriseCardTitle>
                  <EnterpriseCardDescription>
                    {method.account
                      ? `${t("paymentReconciliation.list.clearingAccount")}: ${method.account.code} ${method.account.name}`
                      : t("paymentReconciliation.list.noAccount")}
                  </EnterpriseCardDescription>
                  <EnterpriseCardAction>
                    <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
                  </EnterpriseCardAction>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <MethodSummaryStrip method={method} />
                </EnterpriseCardContent>
              </EnterpriseCard>
            </Link>
          ))}
        </div>
      )}
    </PageWorkspace>
  );
}
