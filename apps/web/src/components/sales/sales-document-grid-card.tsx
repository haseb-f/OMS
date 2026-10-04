"use client";

import type { ReactNode } from "react";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { RecordGridCard, type RecordGridCardProps } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useLocale } from "@/providers/locale-provider";

export interface SalesDocumentGridCardProps {
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
  /** The table's own actions cell, so both views share one permission model. */
  actionsNode: ReactNode;
  /** The document number — the card's reference. */
  number: string;
  /** Customer reference, shown muted after the number. */
  referenceNumber?: string | null;
  /** The party (customer) the document is for. */
  partyName: string;
  /** One short line under the party (phone, linked document). */
  subtitle?: ReactNode;
  /** The document's own workflow status (same label/tone as the table badge). */
  status: { label: string; tone: StatusTone };
  /** Further SEPARATE badges (e.g. payment status) — never merged into the status. */
  extraBadges?: ReactNode;
  /** The key figure people scan for. */
  amount: string | number;
  /** Currency code shown with the key figure. */
  currency?: string | null;
  /** Secondary label/value pairs (at most four). */
  fields: RecordGridCardProps["fields"];
}

/**
 * The one record card every Sales document list (quotations, orders, invoices,
 * returns, receipts, refunds) shares. Entity templates only map their row to
 * these slots; the card itself never decides anything. Colour = the document's
 * workflow status tone, written again as the status badge label.
 */
export function SalesDocumentGridCard({
  selected,
  onToggleSelected,
  href,
  actionsNode,
  number,
  referenceNumber,
  partyName,
  subtitle,
  status,
  extraBadges,
  amount,
  currency,
  fields,
}: SalesDocumentGridCardProps) {
  const { t } = useLocale();
  return (
    <RecordGridCard
      tone={status.tone}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: `${partyName} — ${number}` })}
      recordLabel={`${partyName} — ${number}`}
      title={<LocaleText>{partyName}</LocaleText>}
      subtitle={subtitle}
      href={href}
      reference={
        <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
          <SemanticValue kind="id" className="font-medium">
            {number}
          </SemanticValue>
          {referenceNumber ? <SemanticValue kind="id">{referenceNumber}</SemanticValue> : null}
        </span>
      }
      meta={<MoneyValue value={amount} currency={currency} className="text-foreground" />}
      fields={fields}
      badges={
        <>
          <StatusBadge label={status.label} tone={status.tone} />
          {extraBadges}
        </>
      }
      actionsNode={actionsNode}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
