"use client";

import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { ExchangeRateRow } from "@/services/fx-service";
import { formatFxRate, fxDayLabel, fxSourceLabel } from "./fx-format";

/** Daily rates with provenance: source (CBE official / manual / import) and the CBE buy/sell behind a derived rate. */
export function FxRatesTable({ rates }: { rates: ExchangeRateRow[] }) {
  const { t } = useLocale();
  const columns: CompactDetailColumn<ExchangeRateRow>[] = [
    {
      id: "date",
      header: t("accounting.fx.fields.effectiveDate"),
      cell: (row) => <span className="whitespace-nowrap">{fxDayLabel(t, row.effectiveDate)}</span>,
    },
    {
      id: "rate",
      header: t("accounting.fx.fields.rate"),
      align: "end",
      cell: (row) => (
        <StackedCell
          primary={
            <span className="num">
              {`1 ${row.fromCurrency?.code ?? ""} = ${formatFxRate(row.rate)} ${row.toCurrency?.code ?? ""}`}
            </span>
          }
          secondary={
            row.buyRate != null && row.sellRate != null ? (
              <span>
                {`${t("fxSettings.rates.buySell")}: `}
                <span className="num">{`${formatFxRate(row.buyRate)} / ${formatFxRate(row.sellRate)}`}</span>
              </span>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "source",
      header: t("fxSettings.rates.source"),
      cell: (row) => (
        <StatusBadge
          label={fxSourceLabel(t, row.source)}
          tone={row.source === "CBE" ? "info" : "neutral"}
        />
      ),
    },
  ];
  return (
    <CompactDetailTable
      columns={columns}
      rows={rates}
      rowKey={(row) => row.id}
      viewId="finance-exchange-rates"
      empty={t("common.noDataAvailable")}
    />
  );
}
