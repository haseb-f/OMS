"use client";

import { PrintPage } from "../print-page";
import { PrintTable } from "../print-table";
import {
  PrintDocumentHeader,
  PrintInfo,
  PrintPanels,
  PrintParty,
  PrintQr,
  PrintSection,
  PrintSignatures,
  PrintTotals,
  recordUrl,
  type PrintTotalRow,
} from "../print-blocks";
import { usePrintIdentity } from "../print-brand";
import { formatBusinessDateTime } from "@/lib/business-date";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type {
  DocumentPrintPayload,
  PrintCell,
  PrintColumn,
  PrintCompanyInfo,
  PrintLedger,
} from "@/types/print-engine";

const ROLE_KEY: Record<"customer" | "supplier" | "account", MessageKey> = {
  customer: "printDocument.customer",
  supplier: "printDocument.supplier",
  account: "printDocument.account",
};

/** Account / description / debit / credit — the journal voucher's own layout. */
function LedgerTable({ ledger }: { ledger: PrintLedger }) {
  const { t } = useLocale();
  const columns: PrintColumn[] = [
    { key: "account", label: ledger.labels.account },
    { key: "description", label: ledger.labels.description },
    { key: "debit", label: ledger.labels.debit, align: "end", width: "26mm" },
    { key: "credit", label: ledger.labels.credit, align: "end", width: "26mm" },
  ];
  const amount = (value: number) => (value ? formatMoney(value) : "");
  return (
    <PrintTable
      columns={columns}
      rows={ledger.lines.map((line) => ({
        account: line.account,
        description: line.description ?? "",
        debit: amount(line.debit),
        credit: amount(line.credit),
      }))}
      density={ledger.lines.length > 16 ? "compact" : "normal"}
      totalRow={{
        account: t("printDocument.total"),
        description: "",
        debit: formatMoney(ledger.totalDebit),
        credit: formatMoney(ledger.totalCredit),
      }}
    />
  );
}

/**
 * Commercial documents and vouchers (spec §3): header → party | document
 * info → item table (qty · unit price · discount · tax · total, the discount
 * and tax columns only when the document has them) → payment status and QR |
 * totals with the currency → notes & terms → signatures. A4 portrait unless
 * the payload asks for landscape. A journal voucher (`ledger`) renders its
 * account / debit / credit table instead. Every value comes from the record;
 * nothing is computed here except display formatting.
 */
function DocumentFamilyPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  const { t } = useLocale();
  const { data, title, ledger } = payload;
  const { branding } = data.company;
  const orientation = branding.paperSize === "a4-landscape" ? "landscape" : "portrait";
  const printedAt = formatBusinessDateTime(new Date());
  const qrUrl = recordUrl(payload.recordPath);
  const currency = data.currency;
  const money = (value: number) => formatMoney(value);

  const identity = usePrintIdentity(
    {
      name: data.company.name,
      logoUrl: branding.logoUrl,
      vatNumber: data.company.taxNumber,
      addressLines: data.company.addressLines,
    } satisfies PrintCompanyInfo,
    branding.primaryColor,
  );

  const items = data.lineItems;
  // Receipts / payment vouchers list the documents the amount is applied to.
  const isVoucher = payload.variant === "receipt" || payload.variant === "voucher";
  const hasDiscount = items.some(
    (item) => (item.discount ?? 0) > 0 || (item.discountPercent ?? 0) > 0,
  );
  const hasTax = items.some((item) => (item.taxAmount ?? 0) > 0 || !!item.taxLabel);

  const columns: PrintColumn[] = isVoucher
    ? [
        { key: "index", label: "#", align: "center", width: "8mm", nowrap: true },
        { key: "item", label: t("printDocument.appliedTo") },
        { key: "total", label: t("printDocument.amount"), align: "end", width: "34mm" },
      ]
    : [
        { key: "index", label: "#", align: "center", width: "8mm", nowrap: true },
        { key: "item", label: t("printDocument.item") },
        { key: "qty", label: t("printDocument.qty"), align: "end", width: "18mm" },
        { key: "unitPrice", label: t("printDocument.unitPrice"), align: "end", width: "23mm" },
        ...(hasDiscount
          ? [
              {
                key: "discount",
                label: t("printDocument.discount"),
                align: "end" as const,
                width: "20mm",
              },
            ]
          : []),
        ...(hasTax
          ? [{ key: "tax", label: t("printDocument.tax"), align: "end" as const, width: "22mm" }]
          : []),
        { key: "total", label: t("printDocument.lineTotal"), align: "end", width: "26mm" },
      ];
  const rows: Record<string, PrintCell>[] = items.map((item, index) => ({
    index: String(index + 1),
    item: { text: item.description, sub: item.sku },
    qty: `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`,
    unitPrice: money(item.unitPrice),
    // Server values as stored: a percent and/or a fixed amount (never recomputed here).
    discount:
      [
        item.discountPercent ? `${item.discountPercent}%` : "",
        item.discount ? money(item.discount) : "",
      ]
        .filter(Boolean)
        .join(" + ") || "—",
    tax: {
      text: (item.taxAmount ?? 0) > 0 ? money(item.taxAmount!) : "—",
      sub: item.taxLabel,
    },
    total: money(item.total),
  }));

  const totals: PrintTotalRow[] = data.totals.map((total) => ({
    label: total.label,
    value: total.emphasis && currency ? `${money(total.value)} ${currency}` : money(total.value),
    emphasis: total.emphasis,
  }));

  const role = t(ROLE_KEY[data.partyRole ?? "customer"]);
  const hasParty = !!data.party.name;
  const notesTitle = payload.labels?.notes ?? t("printDocument.terms");

  return (
    <PrintPage orientation={orientation} printedAt={printedAt} accentColor={identity.accentColor}>
      <PrintDocumentHeader
        company={identity.company}
        title={title}
        number={data.documentNumber}
        lines={[
          <>
            {t("printDocument.date")}: <span className="num">{data.documentDate}</span>
          </>,
        ]}
      />

      <PrintPanels
        start={
          hasParty ? (
            <PrintParty
              role={role}
              name={data.party.name}
              lines={[
                ...(data.party.number ? [data.party.number] : []),
                ...data.party.addressLines,
              ]}
              phone={data.party.phone}
              taxNumber={data.party.taxNumber}
            />
          ) : null
        }
        end={
          <>
            <div className="pr-panel-title">{t("printDocument.documentInfo")}</div>
            <PrintInfo
              items={[
                { label: t("printDocument.date"), value: data.documentDate, ltr: true },
                ...data.meta.map((item) => ({ label: item.label, value: item.value })),
                ...(currency ? [{ label: t("reportExport.currency"), value: currency }] : []),
              ]}
            />
          </>
        }
      />

      <div style={{ marginTop: "3mm" }}>
        {ledger ? (
          <LedgerTable ledger={ledger} />
        ) : items.length > 0 ? (
          <PrintTable
            columns={columns}
            rows={rows}
            density={items.length > 14 || columns.length > 6 ? "compact" : "normal"}
          />
        ) : null}
      </div>

      {(!ledger && totals.length > 0) || qrUrl || data.payment ? (
        <div className="pr-after-table" data-print-avoid-break>
          <div style={{ display: "flex", flexDirection: "column", gap: "3mm" }}>
            {data.payment && (
              <div>
                <div className="pr-panel-title">{t("printDocument.paymentStatus")}</div>
                <span className="pr-status">{data.payment.statusLabel}</span>
                <PrintInfo
                  items={[
                    {
                      label: t("printDocument.paid"),
                      value: `${money(data.payment.paid)}${currency ? ` ${currency}` : ""}`,
                      ltr: true,
                    },
                    {
                      label: t("printDocument.remaining"),
                      value: `${money(data.payment.remaining)}${currency ? ` ${currency}` : ""}`,
                      ltr: true,
                    },
                  ]}
                />
              </div>
            )}
            {qrUrl && <PrintQr url={qrUrl} label={t("printDocument.scanToOpen")} />}
          </div>
          {!ledger && <PrintTotals rows={totals} />}
        </div>
      ) : null}

      {currency && !ledger && items.length > 0 ? (
        <p className="pr-footnote">{t("printDocument.amountsIn", { currency })}</p>
      ) : null}

      {data.notes && (
        <PrintSection title={notesTitle}>
          <p>{data.notes}</p>
        </PrintSection>
      )}

      {data.signatures && data.signatures.length > 0 && (
        <PrintSignatures labels={data.signatures} />
      )}
    </PrintPage>
  );
}

/** Tax Invoice, Simplified Invoice, Quotation, Sales/Purchase Order, Returns. */
export function InvoicePrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}

/** Receipt Voucher. */
export function ReceiptPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}

/** Payment Voucher, and Journal Voucher when the payload carries a `ledger`. */
export function VoucherPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}

/** Legacy balance-only statement payloads (`variant: "statement"`) — same layout. */
export function StatementPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}
