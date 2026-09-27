"use client";

import { QRCodeSVG } from "qrcode.react";
import { PrintPage } from "../print-page";
import { PrintCompanyHeader } from "../print-company-header";
import { PrintFooter } from "../print-footer";
import { PrintTable } from "../print-table";
import { usePrintIdentity } from "../print-brand";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import type {
  DocumentPrintPayload,
  PrintColumn,
  PrintCompanyInfo,
  PrintLedger,
} from "@/types/print-engine";

/** In-app URL of the record for the QR code; omitted (no QR) when the payload has no path. */
function recordUrl(recordPath: string | undefined): string | null {
  if (!recordPath || typeof window === "undefined") return null;
  return new URL(recordPath, window.location.origin).toString();
}

function RecordQrCode({ url }: { url: string }) {
  const { t } = useLocale();
  return (
    <div
      data-print-avoid-break
      className="flex items-center gap-2 text-[9px] text-muted-foreground"
    >
      <QRCodeSVG
        value={url}
        size={72}
        level="M"
        marginSize={0}
        title={t("printDocument.scanToOpen")}
      />
      <span className="max-w-32">{t("printDocument.scanToOpen")}</span>
    </div>
  );
}

/** Account / description / debit / credit — the journal voucher's own layout. */
function LedgerTable({ ledger }: { ledger: PrintLedger }) {
  const { t } = useLocale();
  const columns: PrintColumn[] = [
    { key: "account", label: ledger.labels.account, align: "start" },
    { key: "description", label: ledger.labels.description, align: "start" },
    { key: "debit", label: ledger.labels.debit, align: "end" },
    { key: "credit", label: ledger.labels.credit, align: "end" },
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
 * Backs Invoice/Statement/Receipt/Voucher prints: Header → Party / Document
 * info → Lines → Totals → QR → Notes → Signatures. Portrait for documents,
 * LANDSCAPE for statements (Print Policy). A journal voucher (`payload.ledger`)
 * renders its own account/debit/credit table instead of invoice columns.
 * Direction follows the UI language; the accent follows the company brand.
 */
function DocumentFamilyPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  const { t } = useLocale();
  const { data, title, labels, printedByName, ledger } = payload;
  const { branding } = data.company;
  const orientation =
    payload.variant === "statement" || branding.paperSize === "a4-landscape"
      ? "landscape"
      : "portrait";
  const printedAt = formatDateTime(new Date());
  const qrUrl = recordUrl(payload.recordPath);

  const identity = usePrintIdentity(
    {
      name: data.company.name,
      logoUrl: branding.logoUrl,
      vatNumber: data.company.taxNumber,
      addressLines: data.company.addressLines,
    } satisfies PrintCompanyInfo,
    branding.primaryColor,
  );

  const lineColumns: PrintColumn[] = [
    { key: "description", label: labels.description, align: "start" },
    { key: "quantity", label: labels.quantity, align: "end" },
    { key: "unitPrice", label: labels.unitPrice, align: "end" },
    { key: "total", label: labels.lineTotal, align: "end" },
  ];
  const lineRows = data.lineItems.map((item) => ({
    description: item.description,
    quantity: `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`,
    unitPrice: formatMoney(item.unitPrice),
    total: formatMoney(item.total),
  }));

  return (
    <PrintPage orientation={orientation} printedAt={printedAt}>
      <div className="flex flex-col gap-4">
        <PrintCompanyHeader
          company={identity.company}
          title={title}
          documentNumber={data.documentNumber}
          printedByName={printedByName}
          printedAt={printedAt}
          accentColor={identity.accentColor}
        />

        <div
          data-print-avoid-break
          className="grid grid-cols-2 gap-6 border-b border-border pb-3 text-[10px]"
        >
          <div className="flex flex-col gap-0.5 text-muted-foreground">
            {(data.party.name || data.party.addressLines.length > 0) && (
              <>
                <span className="font-medium">{labels.billTo}</span>
                <span className="text-[11.5px] font-medium text-foreground">{data.party.name}</span>
              </>
            )}
            {data.party.taxNumber && (
              <span>
                {t("printDocument.vatNumber")}: <span className="num">{data.party.taxNumber}</span>
              </span>
            )}
            {data.party.addressLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
            {data.party.phone && <span className="num">{data.party.phone}</span>}
          </div>
          <dl className="flex flex-col gap-0.5">
            <div className="flex justify-end gap-2">
              <dt className="text-muted-foreground">{labels.documentDate}</dt>
              <dd className="num font-medium text-foreground">{data.documentDate}</dd>
            </div>
            {data.meta.map((item) => (
              <div key={item.label} className="flex justify-end gap-2">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="font-medium text-foreground">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {ledger ? (
          <LedgerTable ledger={ledger} />
        ) : (
          <PrintTable
            columns={lineColumns}
            rows={lineRows}
            density={data.lineItems.length > 12 ? "compact" : "normal"}
          />
        )}

        {(!ledger && data.totals.length > 0) || qrUrl ? (
          <div data-print-avoid-break className="flex items-start justify-between gap-6">
            <div>{qrUrl && <RecordQrCode url={qrUrl} />}</div>
            {!ledger && data.totals.length > 0 && (
              <div className="flex w-full max-w-72 flex-col gap-1 text-[10.5px]">
                {data.totals.map((total) => (
                  <div
                    key={total.label}
                    className={cn(
                      "flex justify-between gap-4",
                      total.emphasis &&
                        "border-t border-border-strong pt-1 text-[12px] font-semibold text-foreground",
                    )}
                  >
                    <span className={total.emphasis ? undefined : "text-muted-foreground"}>
                      {total.label}
                    </span>
                    <span className="num">
                      {formatMoney(total.value)}
                      {data.currency ? ` ${data.currency}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {data.notes && (
          <div
            data-print-avoid-break
            className="flex flex-col gap-1 border-t border-border pt-2 text-[10px]"
          >
            <span className="font-medium text-muted-foreground">{labels.notes}</span>
            <p className="whitespace-pre-line">{data.notes}</p>
          </div>
        )}

        {data.signatures && data.signatures.length > 0 && (
          <div data-print-avoid-break className="mt-6 grid grid-cols-2 gap-8 text-[10px]">
            {data.signatures.map((signature) => (
              <div key={signature.label} className="flex flex-col gap-8">
                <span className="text-muted-foreground">{signature.label}</span>
                <div className="border-t border-border-strong pt-1">{signature.name ?? ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PrintFooter printedAt={printedAt} />
    </PrintPage>
  );
}

/** Tax Invoice, Simplified Invoice, Quotation, Sales/Purchase Order. */
export function InvoicePrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}

/** Customer/Supplier Statement — always landscape. */
export function StatementPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
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
