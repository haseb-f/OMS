"use client";

import { useCallback } from "react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { EnterpriseBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { investorPortalService } from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import type { MessageKey } from "@/i18n/translate";

/**
 * Read-only in this pass (mission Part 47): the backend Portal API exposes
 * no PATCH route for these fields — see `investor-portal.controller.ts`
 * (only `GET /investor-portal/me`). Adding a live edit flow is out of scope
 * for a frontend-only pass; a fake-looking editable form with nowhere to
 * send the change would be worse than an honest read-only view.
 */
export default function InvestorPortalAccountPage() {
  const { t } = useLocale();
  const fetchMe = useCallback(() => investorPortalService.me(), []);
  const { data, error, isLoading, reload } = usePortalQuery(fetchMe);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("investorPortal.account.title")}</h1>

      <PortalPageState isLoading={isLoading} error={error} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-4">
            <EnterpriseCard>
              <EnterpriseCardHeader>
                <EnterpriseCardTitle>
                  {t("investorPortal.account.profileSection")}
                </EnterpriseCardTitle>
              </EnterpriseCardHeader>
              <EnterpriseCardContent>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("investorPortal.account.fields.name")} value={data.name} />
                  <Field
                    label={t("investorPortal.account.fields.investorType")}
                    value={data.investorType?.name ?? t("investorPortal.common.notAvailable")}
                  />
                  <Field
                    label={t("investorPortal.account.fields.phone")}
                    value={data.phone ?? t("investorPortal.common.notAvailable")}
                  />
                  <Field
                    label={t("investorPortal.account.fields.email")}
                    value={data.email ?? t("investorPortal.common.notAvailable")}
                  />
                  <Field
                    label={t("investorPortal.account.fields.nationalId")}
                    value={data.nationalId ?? t("investorPortal.common.notAvailable")}
                  />
                  <Field
                    label={t("investorPortal.account.fields.residencyId")}
                    value={data.residencyId ?? t("investorPortal.common.notAvailable")}
                  />
                  <Field
                    label={t("investorPortal.account.fields.iban")}
                    value={data.iban ?? t("investorPortal.common.notAvailable")}
                  />
                </dl>
                <p className="mt-4 text-caption text-muted-foreground">
                  {t("investorPortal.account.readOnlyNote")}
                </p>
              </EnterpriseCardContent>
            </EnterpriseCard>

            {data.portalAccount && (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>
                    {t("investorPortal.account.portalAccessSection")}
                  </EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field
                      label={t("investorPortal.account.fields.portalEmail")}
                      value={data.portalAccount.email}
                    />
                    <div>
                      <dt className="text-caption text-muted-foreground">
                        {t("investorPortal.account.fields.portalStatus")}
                      </dt>
                      <dd className="mt-1">
                        <EnterpriseBadge
                          variant={data.portalAccount.status === "ACTIVE" ? "success" : "secondary"}
                        >
                          {t(
                            `investorPortal.accountStatus.${data.portalAccount.status}` as MessageKey,
                          )}
                        </EnterpriseBadge>
                      </dd>
                    </div>
                    <Field
                      label={t("investorPortal.account.fields.lastLoginAt")}
                      value={
                        data.portalAccount.lastLoginAt
                          ? formatDateTime(data.portalAccount.lastLoginAt)
                          : t("investorPortal.common.notAvailable")
                      }
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            )}
          </div>
        )}
      </PortalPageState>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}
