"use client";

import { PrintPage } from "../print-page";
import { PrintTable } from "../print-table";
import {
  PrintDocumentHeader,
  PrintInfo,
  PrintPanels,
  PrintParty,
  PrintQr,
  PrintTotals,
  recordUrl,
} from "../print-blocks";
import { usePrintIdentity } from "../print-brand";
import { formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import type {
  PrintCell,
  PrintColumn,
  PrintRowKind,
  StatementPrintPayload,
} from "@/types/print-engine";

/**
 * Customer / supplier account statement (spec §3): partner identity and the
 * period, then opening balance → dated movements with a running balance →
 * period totals → closing balance. A4 portrait; the six columns fit, long
 * descriptions wrap. Balances are the server's running balances — the
 * template only formats them (a negative balance prints with a minus sign).
 */
export function AccountStatementPrintTemplate({ payload }: { payload: StatementPrintPayload }) {
  const { t } = useLocale();
  const printedAt = formatDateTime(new Date());
  const identity = usePrintIdentity(payload.company);
  const qrUrl = recordUrl(payload.recordPath);
  const money = (value: number) => (value ? formatMoney(value) : "—");
  const balance = (value: number) => formatMoney(value);

  const columns: PrintColumn[] = [
    { key: "date", label: t("printDocument.date"), width: "21mm", nowrap: true },
    { key: "reference", label: t("printDocument.reference"), width: "33mm", nowrap: true },
    { key: "description", label: t("printDocument.description") },
    { key: "debit", label: t("printDocument.debit"), align: "end", width: "24mm" },
    { key: "credit", label: t("printDocument.credit"), align: "end", width: "24mm" },
    { key: "balance", label: t("printDocument.balance"), align: "end", width: "26mm" },
  ];

  const rows: Record<string, PrintCell>[] = [
    {
      date: "",
      reference: "",
      description: t("printDocument.openingBalance"),
      debit: "",
      credit: "",
      balance: balance(payload.openingBalance),
    },
    ...payload.movements.map((movement) => ({
      date: movement.date,
      reference: movement.reference,
      description: movement.description,
      debit: money(movement.debit),
      credit: money(movement.credit),
      balance: balance(movement.balance),
    })),
  ];
  const kinds: PrintRowKind[] = ["opening", ...payload.movements.map(() => "detail" as const)];

  return (
    <PrintPage orientation="portrait" printedAt={printedAt} accentColor={identity.accentColor}>
      <PrintDocumentHeader
        company={identity.company}
        title={payload.title}
        number={payload.party.number}
        lines={[
          <>
            {t("printDocument.period")}: {payload.period}
          </>,
        ]}
      />
      <PrintPanels
        start={
          <PrintParty
            role={t(
              payload.partyRole === "supplier"
                ? "printDocument.supplier"
                : "printDocument.customer",
            )}
            name={payload.party.name}
            lines={payload.party.lines}
            phone={payload.party.phone}
            taxNumber={payload.party.taxNumber}
          />
        }
        end={
          <PrintInfo
            items={[
              { label: t("printDocument.period"), value: payload.period },
              { label: t("reportExport.currency"), value: payload.currency },
              {
                label: t("printDocument.openingBalance"),
                value: balance(payload.openingBalance),
                ltr: true,
              },
              {
                label: t("printDocument.closingBalance"),
                value: balance(payload.closingBalance),
                ltr: true,
              },
            ]}
          />
        }
      />

      <div style={{ marginTop: "3mm" }}>
        <PrintTable
          columns={columns}
          rows={rows}
          rowKinds={kinds}
          density={payload.movements.length > 30 ? "compact" : "normal"}
          totalRow={{
            date: "",
            reference: "",
            description: t("printDocument.periodTotals"),
            debit: formatMoney(payload.periodDebit),
            credit: formatMoney(payload.periodCredit),
            balance: balance(payload.closingBalance),
          }}
        />
        {payload.movements.length === 0 ? (
          <p className="pr-footnote">{t("printDocument.noMovements")}</p>
        ) : null}
      </div>

      <div className="pr-after-table" data-print-avoid-break>
        <div>{qrUrl && <PrintQr url={qrUrl} label={t("printDocument.scanToOpen")} />}</div>
        <PrintTotals
          rows={[
            {
              label: t("printDocument.openingBalance"),
              value: `${balance(payload.openingBalance)} ${payload.currency}`,
            },
            { label: t("printDocument.debit"), value: formatMoney(payload.periodDebit) },
            { label: t("printDocument.credit"), value: formatMoney(payload.periodCredit) },
            {
              label: t("printDocument.closingBalance"),
              value: `${balance(payload.closingBalance)} ${payload.currency}`,
              emphasis: true,
            },
          ]}
        />
      </div>
    </PrintPage>
  );
}
