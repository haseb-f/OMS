"use client";

import { useLocale } from "@/providers/locale-provider";

/**
 * On-screen preview of the sheet footer. On paper the same line and the page
 * numbers are drawn in `@page` margin boxes by `PrintPage` (repeated on every
 * sheet, never overlapping content), so this block is hidden when printing.
 */
export function PrintFooter({
  printedAt,
  signatureLabel,
}: {
  printedAt: string;
  signatureLabel?: string;
}) {
  const { t } = useLocale();
  return (
    <footer className="mt-6 flex items-end justify-between gap-4 border-t border-border pt-2 text-[9px] text-muted-foreground print:hidden">
      <span>
        {t("reportExport.generatedBy")} · {t("reportExport.printedAt")}{" "}
        <span className="num">{printedAt}</span>
      </span>
      {signatureLabel && (
        <span className="border-t border-border-strong px-8 pt-1">{signatureLabel}</span>
      )}
    </footer>
  );
}
