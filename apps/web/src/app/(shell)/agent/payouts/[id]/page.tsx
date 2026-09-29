"use client";

import { useCallback, useEffect, useState } from "react";
import { agentLedgerDescription } from "@/config/agents/agent-ledger-description";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  DetailField,
  DetailSection,
  DetailSummaryBar,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { PageLoading } from "@/components/shared/page-loading";
import { ErrorState } from "@/components/shared/error-state";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { StatusBadge } from "@/components/business/status-badge";
import { PortalFileList } from "@/components/agent-portal/portal-files";
import { entryTypeLabelKey } from "@/config/agent-portal/labels";
import { agentPortalService, type PortalPayoutDetail } from "@/services/agent-portal-service";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { apiErrorMessage } from "@/lib/toast";

type Allocation = PortalPayoutDetail["allocations"][number];

/** Payout detail — the entries it covered and its evidence; read-only for the agent. */
export default function AgentPayoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const [payout, setPayout] = useState<PortalPayoutDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useBreadcrumbLabel(payout?.payoutNumber ?? null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPayout(await agentPortalService.payouts.get(id));
    } catch (err) {
      setError(apiErrorMessage(err, "agentPortal.common.loadFailed"));
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!payout) return <PageLoading />;

  const currency = payout.currency;
  const columns: CompactDetailColumn<Allocation>[] = [
    {
      id: "entry",
      header: t("agentPortal.payouts.detail.entry"),
      cell: (a) => (
        <StackedCell
          primary={agentLedgerDescription(
            {
              entryType: a.entryType,
              description: t(entryTypeLabelKey(a.entryType)),
              references: { orderNumber: a.orderNumber },
            },
            t,
          )}
          secondary={<SemanticValue kind="id">{a.entryNumber}</SemanticValue>}
        />
      ),
    },
    {
      id: "order",
      header: t("agentPortal.payouts.detail.order"),
      cell: (a) =>
        a.storeOrderId && a.orderNumber ? (
          <Link href={`/agent/orders/${a.storeOrderId}`} className="text-primary hover:underline">
            <SemanticValue kind="id">{a.orderNumber}</SemanticValue>
          </Link>
        ) : (
          "—"
        ),
    },
    {
      id: "amount",
      header: t("agentPortal.payouts.fields.amount"),
      align: "end",
      cell: (a) => <MoneyValue value={a.amount} currency={currency} />,
    },
  ];

  return (
    <DetailWorkspace
      title={t("agentPortal.payouts.title")}
      reference={payout.payoutNumber}
      meta={formatDate(payout.payoutDate)}
      status={
        <StatusBadge
          label={t(`agentPortal.status.payout.${payout.status}`)}
          tone={payout.status === "CONFIRMED" ? "success" : "destructive"}
        />
      }
    >
      <DetailSummaryBar>
        <DetailField
          label={t("agentPortal.payouts.fields.amount")}
          value={<MoneyValue value={payout.amount} currency={currency} />}
        />
        <DetailField
          label={t("agentPortal.payouts.fields.date")}
          value={formatDate(payout.payoutDate)}
        />
        <DetailField
          label={t("agentPortal.payouts.fields.reference")}
          value={
            payout.reference ? <SemanticValue kind="id">{payout.reference}</SemanticValue> : null
          }
        />
        <DetailField
          label={t("agentPortal.payouts.fields.account")}
          value={payout.payingAccount?.name}
        />
        {payout.reversedAt ? (
          <DetailField
            label={t("agentPortal.status.payout.REVERSED")}
            value={
              <>
                {t("agentPortal.payouts.detail.reversed", { date: formatDate(payout.reversedAt) })}
                {payout.reversalReason ? ` — ${payout.reversalReason}` : ""}
              </>
            }
            className="col-span-2"
          />
        ) : null}
      </DetailSummaryBar>

      <DetailSection title={t("agentPortal.payouts.detail.allocationsTitle")}>
        <CompactDetailTable
          columns={columns}
          rows={payout.allocations}
          rowKey={(a) => `${a.entryNumber}-${a.amount}`}
        />
      </DetailSection>

      <DetailSection title={t("agentPortal.payouts.detail.evidenceTitle")}>
        <PortalFileList
          files={payout.attachments}
          emptyText={t("agentPortal.payouts.detail.noEvidence")}
        />
      </DetailSection>
    </DetailWorkspace>
  );
}
