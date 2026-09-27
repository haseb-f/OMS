"use client";

import { useLocale } from "@/providers/locale-provider";
import type { PrintCompanyInfo } from "@/types/print-engine";

/**
 * Shared document header — company identity on the start side (logo, legal
 * name, then tax number / CR / address / phone when the company profile has
 * them), document identity (title / number / printed-by / printed-at) on the
 * end side. Every print template renders through this component.
 */
export function PrintCompanyHeader({
  company,
  title,
  documentNumber,
  printedByName,
  printedAt,
  accentColor = "var(--primary)",
}: {
  company: PrintCompanyInfo;
  title: string;
  documentNumber?: string;
  printedByName: string | null;
  printedAt: string;
  /** Brand accent for the rule under the header and the logo fallback tile. */
  accentColor?: string;
}) {
  const { t } = useLocale();
  const contactLine = [company.phone, company.email, company.website].filter(Boolean);

  return (
    <header
      data-print-avoid-break
      className="flex items-start justify-between gap-6 border-b-2 pb-3"
      style={{ borderColor: accentColor }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-14 w-auto max-w-40 object-contain" />
        ) : (
          <div
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-sm text-lg font-semibold text-primary-foreground"
            style={{ backgroundColor: accentColor }}
          >
            {company.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-0.5 text-[10px] leading-normal text-muted-foreground">
          <span className="text-[13px] font-semibold text-foreground">{company.name}</span>
          {company.vatNumber && (
            <span>
              {t("printDocument.vatNumber")}: <span className="num">{company.vatNumber}</span>
            </span>
          )}
          {company.crNumber && (
            <span>
              {t("printDocument.crNumber")}: <span className="num">{company.crNumber}</span>
            </span>
          )}
          {company.addressLines?.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {contactLine.length > 0 && (
            <span className="flex flex-wrap gap-x-3">
              {contactLine.map((value) => (
                <span key={value} className="num">
                  {value}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-end text-[10px] leading-normal text-muted-foreground">
        <h1 className="text-[15px] font-semibold text-foreground">{title}</h1>
        {documentNumber && (
          <span>
            {t("reportExport.documentNumber")} <span className="num">{documentNumber}</span>
          </span>
        )}
        <span>
          {t("reportExport.printedBy")}: {printedByName ?? "—"}
        </span>
        <span>
          {t("reportExport.printedAt")}: <span className="num">{printedAt}</span>
        </span>
      </div>
    </header>
  );
}
