"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Landmark, Scale } from "lucide-react";
import { RowIdentityLink } from "@/components/shared/data-table/row-identity-link";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { KpiCard } from "@/components/shared/kpi-card";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { recordHref } from "@/config/traceability/record-routes";
import type { TraceKind } from "@/services/traceability-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { ApiError } from "@/services/api-client";
import {
  paymentSettlementsService,
  type AccountRef,
  type ProviderBalance,
  type RateBasis,
} from "@/services/payment-settlements-service";

/** LTR record link (order, receipt, JE) — plain text when the kind has no page. */
export function RecordLink({
  kind,
  id,
  label,
}: {
  kind: TraceKind;
  id: string | null | undefined;
  label: string | null | undefined;
}) {
  if (!label) return null;
  const href = id ? recordHref(kind, id) : null;
  const text = <SemanticValue kind="id">{label}</SemanticValue>;
  return href ? <RowIdentityLink href={href}>{text}</RowIdentityLink> : text;
}

export interface JournalTableLine {
  key: string;
  account: AccountRef | null;
  description: string | null;
  debit: string | number;
  credit: string | number;
}

/** One JE line table for the preview and the settlement detail (functional currency). */
export function SettlementJournalTable({
  lines,
  currency,
  totalDebit,
  totalCredit,
}: {
  lines: JournalTableLine[];
  currency: string;
  totalDebit: string;
  totalCredit: string;
}) {
  const { t } = useLocale();
  const amount = (value: string | number) =>
    Number(value) === 0 ? "" : <MoneyValue value={value} currency={currency} />;
  return (
    <CompactDetailTable
      rows={lines}
      rowKey={(line) => line.key}
      columns={[
        {
          id: "account",
          header: t("paymentSettlement.preview.account"),
          cell: (line) => (
            <StackedCell
              primary={
                line.account ? (
                  <span>
                    <SemanticValue kind="id">{line.account.code}</SemanticValue> {line.account.name}
                  </span>
                ) : (
                  "—"
                )
              }
              secondary={line.description}
            />
          ),
          footer: t("paymentSettlement.preview.total"),
        },
        {
          id: "debit",
          header: t("paymentSettlement.preview.debit"),
          align: "end",
          cell: (line) => amount(line.debit),
          footer: <MoneyValue value={totalDebit} currency={currency} />,
        },
        {
          id: "credit",
          header: t("paymentSettlement.preview.credit"),
          align: "end",
          cell: (line) => amount(line.credit),
          footer: <MoneyValue value={totalCredit} currency={currency} />,
        },
      ]}
    />
  );
}

/** Rates frozen on the settlement: "1 SAR = 13.2 EGP · CBE · effective 2026-09-15". */
export function RatesSummary({
  rates,
  functionalCode,
}: {
  rates: RateBasis[];
  functionalCode: string;
}) {
  const { t } = useLocale();
  const unique = rates.filter(
    (rate, index) => rates.findIndex((r) => r.currencyId === rate.currencyId) === index,
  );
  return (
    <ul className="flex flex-col gap-1 text-caption">
      {unique.map((rate) => (
        <li key={rate.currencyId} className="flex flex-wrap items-baseline gap-x-2">
          <SemanticValue kind="number">
            {t("paymentSettlement.preview.rateLine", {
              from: rate.currencyCode,
              rate: rate.rate,
              to: functionalCode,
            })}
          </SemanticValue>
          <span className="text-muted-foreground">
            {t("paymentSettlement.preview.rateSource", {
              source: rate.source,
              date: formatDate(rate.effectiveDate),
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Clearing GL balance vs Σ unsettled carrying values — the provider's open balance, reconciled. */
export function ProviderBalanceCard({
  methodId,
  refreshKey,
}: {
  methodId: string;
  refreshKey: number;
}) {
  const { t } = useLocale();
  const [balance, setBalance] = useState<ProviderBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBalance(await paymentSettlementsService.providerBalance(methodId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.loadFailed"));
    }
  }, [methodId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  if (error) {
    return <p className="text-caption text-destructive">{error}</p>;
  }
  if (!balance) return null;
  if (!balance.configured) {
    return (
      <p className="text-caption text-muted-foreground">
        {t("paymentSettlement.balance.notConfigured")}
      </p>
    );
  }
  const code = balance.functionalCurrency?.code ?? null;
  const reconciled = Number(balance.difference ?? 0) === 0;
  return (
    <section aria-label={t("paymentSettlement.balance.title")} className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <KpiCard
          icon={Landmark}
          tone="info"
          label={t("paymentSettlement.balance.gl")}
          value={formatMoney(balance.glBalance ?? 0, code)}
          description={
            balance.clearingAccount
              ? `${balance.clearingAccount.code} ${balance.clearingAccount.name}`
              : undefined
          }
        />
        <KpiCard
          icon={Scale}
          tone="primary"
          label={t("paymentSettlement.balance.unsettled")}
          value={formatMoney(balance.unsettledCarrying ?? 0, code)}
          description={balance.unsettledByCurrency
            .map((row) => formatMoney(row.remainingAmount, row.currency.code))
            .join(" · ")}
        />
        <KpiCard
          icon={reconciled ? CheckCircle2 : AlertTriangle}
          tone={reconciled ? "success" : "warning"}
          label={t("paymentSettlement.balance.difference")}
          value={formatMoney(balance.difference ?? 0, code)}
          description={reconciled ? t("paymentSettlement.balance.reconciled") : undefined}
        />
      </div>
      {!reconciled ? (
        <p className="text-caption text-warning-foreground">
          {t("paymentSettlement.balance.notReconciled")}
        </p>
      ) : null}
    </section>
  );
}
