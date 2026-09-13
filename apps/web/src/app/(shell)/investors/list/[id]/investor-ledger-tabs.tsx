"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import {
  investmentDistributionsService,
  type ProfitDistributionRow,
} from "@/services/investment-distributions-service";
import {
  investorLedgerService,
  type InvestorLedgerEntryRow,
} from "@/services/investor-ledger-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

const DISTRIBUTION_TONE: Record<
  ProfitDistributionRow["status"],
  "success" | "neutral" | "warning" | "destructive"
> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "destructive",
};

/** Investor Engine Milestone 3, Phase 44 — per-Opportunity approved/paid/outstanding, one row per Distribution this Investor is entitled in. */
export function ProfitsTab({ investorId }: { investorId: string }) {
  const { t } = useLocale();
  const [distributions, setDistributions] = useState<ProfitDistributionRow[] | null>(null);

  const load = useCallback(async () => {
    const result = await investmentDistributionsService.list({ investorId, pageSize: 100 });
    setDistributions(result.items);
  }, [investorId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!distributions) return null;
  if (distributions.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t("investors.ledger.profitsTab.empty")} />;
  }

  return (
    <DetailSection>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-body">
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th className="p-2 text-start">{t("investors.ledger.profitsTab.opportunity")}</th>
              <th className="p-2 text-start">{t("investors.ledger.profitsTab.approvedProfit")}</th>
              <th className="p-2 text-start">{t("investors.ledger.profitsTab.paid")}</th>
              <th className="p-2 text-start">{t("investors.ledger.profitsTab.outstanding")}</th>
              <th className="p-2 text-start">{t("investors.ledger.profitsTab.status")}</th>
            </tr>
          </thead>
          <tbody>
            {distributions.map((distribution) => {
              const row = distribution.investorDistributions.find(
                (r) => r.investorId === investorId,
              );
              if (!row) return null;
              return (
                <tr key={distribution.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">
                    <a
                      href={`/investors/opportunities/${distribution.opportunityId}`}
                      className="hover:underline"
                    >
                      {distribution.opportunityCode}
                    </a>
                  </td>
                  <td className="p-2">{formatMoney(row.entitledAmount)}</td>
                  <td className="p-2">{formatMoney(row.paidAmount)}</td>
                  <td className="p-2">{formatMoney(row.outstandingAmount)}</td>
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.distributions.investorStatus.${row.status}` as never)}
                      tone={DISTRIBUTION_TONE[distribution.status]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

const PAGE_SIZE = 20;

/** Investor Engine Milestone 3, Phase 45/57 — the admin-facing Investor Statement, server-paginated. */
export function StatementTab({ investorId }: { investorId: string }) {
  const { t } = useLocale();
  const [entries, setEntries] = useState<InvestorLedgerEntryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const result = await investorLedgerService.statement(investorId, { page, pageSize: PAGE_SIZE });
    setEntries(result.items);
    setTotal(result.total);
  }, [investorId, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!entries) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DetailSection>
      {entries.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t("investors.ledger.statement.empty")}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-body">
              <thead>
                <tr className="border-b border-border text-caption text-muted-foreground">
                  <th className="p-2 text-start">{t("investors.ledger.statement.date")}</th>
                  <th className="p-2 text-start">{t("investors.ledger.statement.type")}</th>
                  <th className="p-2 text-start">{t("investors.ledger.statement.description")}</th>
                  <th className="p-2 text-start">{t("investors.ledger.statement.debit")}</th>
                  <th className="p-2 text-start">{t("investors.ledger.statement.credit")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60">
                    <td className="p-2">{formatDate(entry.entryDate)}</td>
                    <td className="p-2">
                      <StatusBadge
                        label={t(`investors.ledger.entryType.${entry.type}` as never)}
                        tone="neutral"
                      />
                    </td>
                    <td className="p-2">{entry.description}</td>
                    <td className="p-2">
                      {entry.debitAmount > 0 ? formatMoney(entry.debitAmount) : "—"}
                    </td>
                    <td className="p-2">
                      {entry.creditAmount > 0 ? formatMoney(entry.creditAmount) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <EnterpriseButton
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t("common.previous")}
              </EnterpriseButton>
              <span className="text-caption text-muted-foreground">
                {page} / {totalPages}
              </span>
              <EnterpriseButton
                size="sm"
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("common.next")}
              </EnterpriseButton>
            </div>
          ) : null}
        </>
      )}
    </DetailSection>
  );
}
