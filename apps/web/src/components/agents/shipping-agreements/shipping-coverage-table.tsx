"use client";

import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { MoneyValue } from "@/components/shared/money-value";
import { useLocale } from "@/providers/locale-provider";
import type { ShippingCoverageDestination } from "./shipping-agreements-api";
import { SHIPPING_SERVICES, destinationName } from "./shipping-agreement-view";

/**
 * The service × destination matrix of a shipping agreement (spec-w3 §6):
 * one row per destination the agreement names, one column per service. A
 * cell is what an order to that destination is charged — its own row, or a
 * broader row it inherits (muted, marked) — and an empty combination is
 * marked missing. Below `sm` every destination renders as a card.
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
        return cell.inherited ? (
          <span className="flex flex-col items-end text-muted-foreground">
            <MoneyValue value={cell.amount} currency={currency} className="font-normal" />
            <span className="text-micro">{t("agentShippingAgreements.inherited")}</span>
          </span>
        ) : (
          <MoneyValue value={cell.amount} currency={currency} />
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
