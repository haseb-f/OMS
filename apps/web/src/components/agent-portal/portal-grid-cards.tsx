"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { RecordGridCard } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { entryTypeLabelKey, localizedName } from "@/config/agent-portal/labels";
import { agentLedgerDescription } from "@/config/agents/agent-ledger-description";
import { portalLineHref, portalLineReference } from "@/config/agent-portal/statement-print";
import { formatBusinessDate } from "@/lib/business-date";
import { formatDate } from "@/lib/date";
import { formatNumber } from "@/lib/format-number";
import { useLocale } from "@/providers/locale-provider";
import type {
  PortalPayoutRow,
  PortalStatementLine,
  PortalStockRow,
} from "@/services/agent-portal-service";

/**
 * Agent-portal record cards of the Grid view (R9).
 *
 * SECURITY (card-templates.md rule 1): these cards are the agent's own
 * read-only view. They are typed against the PORTAL row types only and read
 * nothing but fields those types declare and the portal table already shows -
 * never a company cost, margin, internal commission, or another agent's data.
 * Do not import a company row type or service here; `portal-grid-cards.spec.tsx`
 * proves no property outside the portal row type reaches the DOM.
 */

interface PortalCardCommon {
  selected: boolean;
  onToggleSelected: () => void;
}

/** A payout the company made to the agent. Colour = outcome (confirmed / reversed). */
export function PortalPayoutGridCard({
  payout,
  ...common
}: PortalCardCommon & { payout: PortalPayoutRow }) {
  const { t } = useLocale();
  const confirmed = payout.status === "CONFIRMED";
  return (
    <RecordGridCard
      {...common}
      tone={confirmed ? "success" : "destructive"}
      selectLabel={t("tableViews.card.selectRow", { name: payout.payoutNumber })}
      title={
        <SemanticValue kind="id" className="font-medium">
          {payout.payoutNumber}
        </SemanticValue>
      }
      href={`/agent/payouts/${payout.id}`}
      subtitle={payout.payingAccount?.name ?? null}
      reference={<SemanticValue kind="date">{formatDate(payout.payoutDate)}</SemanticValue>}
      meta={
        <MoneyValue value={payout.amount} currency={payout.currency} className="text-foreground" />
      }
      fields={
        payout.reference
          ? [
              {
                key: "reference",
                label: t("agentPortal.payouts.fields.reference"),
                value: <SemanticValue kind="id">{payout.reference}</SemanticValue>,
              },
            ]
          : []
      }
      badges={
        <StatusBadge
          label={t(`agentPortal.status.payout.${payout.status}`)}
          tone={confirmed ? "success" : "destructive"}
        />
      }
    />
  );
}

/**
 * One account-statement line. The card keeps the ledger's meaning: the three
 * figures are the line's debit, credit and running balance; a memo line is
 * muted and labelled (it never moves the balance).
 */
export function PortalStatementGridCard({
  line,
  ...common
}: PortalCardCommon & { line: PortalStatementLine }) {
  const { t } = useLocale();
  const href = portalLineHref(line);
  const reference = portalLineReference(line);
  const description = agentLedgerDescription(line, t);
  return (
    <RecordGridCard
      {...common}
      tone="neutral"
      selectLabel={t("tableViews.card.selectRow", { name: reference })}
      title={
        <SemanticValue kind="id" className="font-medium">
          {reference}
        </SemanticValue>
      }
      href={href ?? undefined}
      subtitle={
        <span className={line.memo ? "italic" : undefined}>
          {t(entryTypeLabelKey(line.entryType))}
        </span>
      }
      reference={<LocaleText>{description || "—"}</LocaleText>}
      meta={<SemanticValue kind="date">{formatBusinessDate(line.entryDate)}</SemanticValue>}
      fields={[
        {
          key: "debit",
          label: t("agentPortal.statement.fields.debit"),
          value: (
            <ReportMoney
              align="inline"
              value={!line.debit ? undefined : line.debit}
              quiet={line.memo}
            />
          ),
          numeric: true,
        },
        {
          key: "credit",
          label: t("agentPortal.statement.fields.credit"),
          value: (
            <ReportMoney
              align="inline"
              value={!line.credit ? undefined : line.credit}
              quiet={line.memo}
            />
          ),
          numeric: true,
        },
        {
          key: "balance",
          label: t("agentPortal.statement.fields.balance"),
          value: <ReportMoney align="inline" value={line.balance} />,
          numeric: true,
        },
      ]}
      badges={
        line.memo ? <StatusBadge label={t("agentPortal.statement.memo")} tone="neutral" /> : null
      }
    />
  );
}

/** One product held by the company for the agent, per warehouse. */
export function PortalStockGridCard({
  row,
  ...common
}: PortalCardCommon & { row: PortalStockRow }) {
  const { t, locale } = useLocale();
  const name = localizedName(row.product, locale);
  return (
    <RecordGridCard
      {...common}
      tone="neutral"
      selectLabel={t("tableViews.card.selectRow", { name })}
      title={<LocaleText>{name}</LocaleText>}
      subtitle={<SemanticValue kind="id">{row.product.sku}</SemanticValue>}
      reference={
        row.warehouse ? (
          <LocaleText>{row.warehouse.name}</LocaleText>
        ) : (
          t("agentPortal.stock.noWarehouse")
        )
      }
      meta={
        <span className="inline-flex items-baseline gap-1.5">
          <span>{t("agentPortal.stock.fields.available")}</span>
          <span className="num font-medium text-foreground">{formatNumber(row.available)}</span>
        </span>
      }
      fields={(["onHand", "reserved", "shipped", "returned"] as const).map((key) => ({
        key,
        label: t(`agentPortal.stock.fields.${key}`),
        value: <span className="num">{formatNumber(row[key])}</span>,
        numeric: true,
      }))}
    />
  );
}
