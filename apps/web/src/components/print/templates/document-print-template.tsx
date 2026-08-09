import { QrCode } from "lucide-react";
import { PrintPage } from "../print-page";
import { PrintCompanyHeader } from "../print-company-header";
import { PrintFooter } from "../print-footer";
import { PrintTable } from "../print-table";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";
import type { DocumentPrintPayload, PrintCompanyInfo, PrintColumn } from "@/types/print-engine";

/**
 * Backs Invoice/Statement/Receipt/Voucher print templates — every
 * document-shaped print (has a party, line items, and totals) renders
 * through this one layout: Header → Party/Document Info → Line Items
 * (via the same `PrintTable` list/report prints use) → Totals → QR →
 * Notes → Signatures → Footer. Only the title and orientation differ
 * between document types, so those are the only things the four exported
 * templates below vary.
 */
function DocumentFamilyPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  const { data, title, labels, printedByName } = payload;
  const { branding } = data.company;
  const orientation = branding.paperSize === "a4-landscape" ? "landscape" : "portrait";
  const printedAt = formatDateTime(new Date());

  const printCompany: PrintCompanyInfo = {
    name: data.company.name,
    logoUrl: branding.logoUrl,
    vatNumber: data.company.taxNumber,
    addressLines: data.company.addressLines,
  };

  const lineColumns: PrintColumn[] = [
    { key: "description", label: labels.description, align: "start" },
    { key: "quantity", label: labels.quantity, align: "end" },
    { key: "unitPrice", label: labels.unitPrice, align: "end" },
    { key: "total", label: labels.lineTotal, align: "end" },
  ];
  const lineRows = data.lineItems.map((item) => ({
    description: item.description,
    quantity: `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`,
    unitPrice: item.unitPrice.toFixed(2),
    total: item.total.toFixed(2),
  }));

  return (
    <PrintPage orientation={orientation}>
      <div dir={branding.language === "ltr" ? "ltr" : "rtl"} className="flex flex-col gap-4">
        <PrintCompanyHeader
          company={printCompany}
          title={title}
          documentNumber={data.documentNumber}
          printedByName={printedByName}
          printedAt={printedAt}
          accentColor={branding.primaryColor}
        />

        <div className="grid grid-cols-2 gap-6 border-b border-slate-200 pb-3">
          <div className="flex flex-col gap-0.5 text-[10px] text-slate-600">
            <span className="font-medium text-slate-500">{labels.billTo}</span>
            <span className="text-[11px] font-medium text-slate-900">{data.party.name}</span>
            {data.party.taxNumber && <span>{data.party.taxNumber}</span>}
            {data.party.addressLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
          <dl className="flex flex-col gap-0.5 text-end text-[10px]">
            <div className="flex justify-end gap-2">
              <dt className="text-slate-500">{labels.documentDate}</dt>
              <dd className="font-medium text-slate-900">{data.documentDate}</dd>
            </div>
            {data.meta.map((item) => (
              <div key={item.label} className="flex justify-end gap-2">
                <dt className="text-slate-500">{item.label}</dt>
                <dd className="font-medium text-slate-900">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <PrintTable
          columns={lineColumns}
          rows={lineRows}
          density={data.lineItems.length > 12 ? "compact" : "normal"}
        />

        <div className="flex justify-end">
          <div className="flex w-full max-w-64 flex-col gap-1 text-[10px]">
            {data.totals.map((total) => (
              <div
                key={total.label}
                className={cn(
                  "flex justify-between",
                  total.emphasis &&
                    "border-t border-slate-300 pt-1 text-[11px] font-semibold text-slate-900",
                )}
              >
                <span className={total.emphasis ? undefined : "text-slate-500"}>{total.label}</span>
                <span className="tabular-nums">
                  {total.value.toFixed(2)} {data.currency}
                </span>
              </div>
            ))}
          </div>
        </div>

        {data.qrCode?.enabled && (
          <div className="flex items-center gap-2 self-end text-[10px] text-slate-500">
            <QrCode className="size-8" />
            <span>{data.qrCode.complianceProfile ?? "QR"}</span>
          </div>
        )}

        {data.notes && (
          <div className="flex flex-col gap-1 border-t border-slate-200 pt-2 text-[10px]">
            <span className="font-medium text-slate-500">{labels.notes}</span>
            <p>{data.notes}</p>
          </div>
        )}

        {data.signatures && data.signatures.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-6 text-[10px]">
            {data.signatures.map((signature) => (
              <div key={signature.label} className="flex flex-col gap-6">
                <span className="text-slate-500">{signature.label}</span>
                <div className="border-t border-slate-400 pt-1 text-slate-600">
                  {signature.name ?? ""}
                </div>
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

/** Customer/Supplier Statement. */
export function StatementPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}

/** Receipt Voucher. */
export function ReceiptPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}

/** Payment/Journal Voucher. */
export function VoucherPrintTemplate({ payload }: { payload: DocumentPrintPayload }) {
  return <DocumentFamilyPrintTemplate payload={payload} />;
}
