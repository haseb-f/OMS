"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { PageLoading } from "@/components/shared/page-loading";
import { ErrorState } from "@/components/shared/error-state";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EnterpriseButton } from "@/components/ui/button";
import { LeadStatusBadge } from "@/components/agent-portal/portal-badges";
import { FollowUpOutcomeBadge } from "@/components/crm/follow-up-outcome-badge";
import { canConvertLead, localizedName } from "@/config/agent-portal/labels";
import { agentPortalService, type PortalLead } from "@/services/agent-portal-service";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDateTime } from "@/lib/date";
import { apiErrorMessage } from "@/lib/toast";

/** Agent lead detail with the Convert action (→ the order form, prefilled from the lead). */
export default function AgentLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const [lead, setLead] = useState<PortalLead | null>(null);
  const [error, setError] = useState<string | null>(null);

  useBreadcrumbLabel(lead?.leadNumber ?? null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLead(await agentPortalService.leads.get(id));
    } catch (err) {
      setError(apiErrorMessage(err, "agentPortal.common.loadFailed"));
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!lead) return <PageLoading />;

  const mayConvert = hasPermission("agent.leads.convert") && hasPermission("agent.orders.create");
  const convertible = canConvertLead(lead);
  const closed = lead.status.code === "LOST" || lead.status.code === "DISQUALIFIED";

  return (
    <DetailWorkspace
      title={lead.customerName}
      reference={lead.leadNumber}
      copyValue={lead.leadNumber}
      meta={formatDateTime(lead.createdAt)}
      status={<LeadStatusBadge status={lead.status} />}
      actions={
        mayConvert && convertible ? (
          <EnterpriseButton
            type="button"
            onClick={() => router.push(`/agent/orders/new?leadId=${lead.id}`)}
          >
            <ArrowLeftRight />
            {t("agentPortal.leads.detail.convert")}
          </EnterpriseButton>
        ) : null
      }
    >
      {lead.storeOrder ? (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-body">
          <Link
            href={`/agent/orders/${lead.storeOrder.id}`}
            className="text-primary hover:underline"
          >
            {t("agentPortal.leads.detail.converted", { number: lead.storeOrder.internalOrderId })}
          </Link>
        </p>
      ) : closed ? (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-caption text-muted-foreground">
          {t("agentPortal.leads.detail.closed")}
        </p>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <DetailSection title={t("agentPortal.leads.detail.customer")}>
          <DetailFieldGrid>
            <DetailField
              label={t("agentPortal.leads.fields.customerName")}
              value={lead.customerName}
            />
            <DetailField
              label={t("agentPortal.leads.fields.mobile")}
              value={
                <SemanticValue kind="phone" copyable>
                  {lead.mobileNumber}
                </SemanticValue>
              }
            />
            <DetailField
              label={t("agentPortal.leads.fields.country")}
              value={localizedName(lead.country, locale)}
            />
            <DetailField label={t("agentPortal.leads.fields.city")} value={lead.city} />
            <DetailField
              label={t("agentPortal.leads.fields.address")}
              value={lead.address}
              className="sm:col-span-2"
            />
          </DetailFieldGrid>
        </DetailSection>
        <DetailSection title={t("agentPortal.leads.detail.interest")}>
          <DetailFieldGrid>
            <DetailField
              label={t("agentPortal.leads.fields.product")}
              value={lead.product ? localizedName(lead.product, locale) : null}
            />
            <DetailField
              label={t("agentPortal.leads.fields.quantity")}
              value={lead.quantity ? <span className="num">{lead.quantity}</span> : null}
            />
            <DetailField
              label={t("agentPortal.leads.fields.fulfillmentMethod")}
              value={
                lead.fulfillmentMethod
                  ? t(`agentPortal.status.method.${lead.fulfillmentMethod}`)
                  : null
              }
            />
            <DetailField
              label={t("agentPortal.leads.fields.owner")}
              value={lead.salesEmployee?.fullName}
            />
            {lead.followUpOutcome ? (
              <DetailField
                label={t("leadOps.outcome.label")}
                value={<FollowUpOutcomeBadge value={lead.followUpOutcome} />}
              />
            ) : null}
          </DetailFieldGrid>
        </DetailSection>
      </div>
    </DetailWorkspace>
  );
}
