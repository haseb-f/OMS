import type { PrintCompanyInfo } from "@/types/print-engine";

/**
 * Shared document header — company identity on the start side, document
 * identity (title/number/printed-by/printed-date) on the end side. Every
 * print template (list, report, invoice, statement, receipt, voucher)
 * renders through this same component; none of them build their own.
 */
export function PrintCompanyHeader({
  company,
  title,
  documentNumber,
  printedByName,
  printedAt,
  accentColor,
}: {
  company: PrintCompanyInfo;
  title: string;
  documentNumber?: string;
  printedByName: string | null;
  printedAt: string;
  /** Optional per-company brand color (from DocumentBranding) for the title/border accent — falls back to a neutral ink color. */
  accentColor?: string;
}) {
  const contactLine = [company.phone, company.email, company.website].filter(Boolean).join("  ·  ");

  return (
    <header
      className="flex items-start justify-between gap-6 border-b-2 pb-3"
      style={{ borderColor: accentColor ?? "#0f172a" }}
    >
      <div className="flex items-center gap-3">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-14 w-auto object-contain" />
        ) : (
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded text-lg font-semibold text-white"
            style={{ backgroundColor: accentColor ?? "#0f172a" }}
          >
            {company.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex flex-col gap-0.5 text-[10px] leading-snug text-slate-600">
          <span className="text-sm font-semibold text-slate-900">{company.name}</span>
          {company.vatNumber && <span>VAT: {company.vatNumber}</span>}
          {company.crNumber && <span>CR: {company.crNumber}</span>}
          {company.addressLines?.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {contactLine && <span>{contactLine}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-end text-[10px] text-slate-600">
        <h1 className="text-base font-semibold text-slate-900">{title}</h1>
        {documentNumber && <span>No. {documentNumber}</span>}
        <span>Printed By: {printedByName ?? "—"}</span>
        <span>Printed Date: {printedAt}</span>
      </div>
    </header>
  );
}
