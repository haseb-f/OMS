"use client";

import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { MoneyValue } from "@/components/shared/money-value";
import { useLocale } from "@/providers/locale-provider";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ShippingCoverageDestination } from "./shipping-agreements-api";
import { SHIPPING_SERVICES, destinationName } from "./shipping-agreement-view";

/**
 * The service × destination matrix of a shipping agreement (spec-w3 §6):
 * one row per destination the agreement names, one column per service. A
 * cell is what an order to that destination is charged — its own row, or a
 * broader row it inherits (muted, marked) or the default row (R17 §3), with
 * the COD collection fee make-up — and an empty combination is marked
 * missing. Below `sm` every destination renders as a card.
 */
export function ShippingCoverageTable({
  destinations,
  currency,
}: {
  destinations: ShippingCoverageDestination[];
  currency: string;
}) {
  const { t, locale } = useLocale();
  const columns: CompactDetailColumn<ShippingCoverageDestination>[] = [
    {
      id: "destination",
      header: t("agentShippingAgreements.destination"),
      cell: (row) => (
        <span className="flex flex-col">
          <span>
            {destinationName(row, locale) ?? t("agentShippingAgreements.allDestinations")}
          </span>
          {row.scope === "COUNTRY" ? (
            <span className="text-caption text-muted-foreground">
              {t("agentShippingAgreements.wholeCountry")}
            </span>
          ) : null}
        </span>
      ),
    },
    ...SHIPPING_SERVICES.map((service): CompactDetailColumn<ShippingCoverageDestination> => ({
      id: service,
      align: "end",
      header: t(`agentShippingAgreements.services.${service}`),
      cell: (row) => {
        const cell = row.cells[service];
        if (!cell) {
          return (
            <span className="text-caption font-medium text-warning-soft-foreground">
              {t("agentShippingAgreements.missing")}
            </span>
          );
        }
        // R17 §3 — how the charge is made up: inherited / default row, COD fee.
        const notes = [
          cell.inherited
            ? t("agentShippingAgreements.inherited")
            : cell.rowService === "ANY"
              ? t("agentShippingAgreements.defaultRate")
              : null,
          cell.codFeeMode === "ADDED"
            ? t("agentShippingAgreements.codFeeAddedShort", {
                base: formatAmount(cell.base),
                fee: formatAmount(cell.amount - cell.base),
              })
            : cell.codFeeMode === "INCLUDED"
              ? t("agentShippingAgreements.codFeeIncludedShort")
              : null,
        ].filter((note): note is string => !!note);
        return (
          <span
            className={cn(
              "flex flex-col items-end",
              (cell.inherited || cell.rowService === "ANY") && "text-muted-foreground",
            )}
          >
            <MoneyValue
              value={cell.amount}
              currency={currency}
              className={cell.inherited ? "font-normal" : undefined}
            />
            {notes.map((note) => (
              <span key={note} className="text-micro" dir="auto">
                {note}
              </span>
            ))}
          </span>
        );
      },
    })),
  ];
  return (
    <CompactDetailTable
      columns={columns}
      rows={destinations}
      rowKey={(row) => row.key}
      empty={t("agentShippingAgreements.editor.noRates")}
      stacked
    />
  );
}
