"use client";

import { useLocale } from "@/providers/locale-provider";
import {
  DocumentTotalsBlock,
  DocumentTotalsSkeleton,
} from "@/components/documents/document-totals";
import {
  commercialTotalsRows,
  type CommercialTotalsRowKey,
} from "@/components/documents/document-totals-math";
import type { MessageKey } from "@/i18n/translate";

/**
 * The totals shape every commercial document (sales and purchase
 * quotations, orders, invoices, returns) shares. While a document is being
 * edited `CommercialDocumentEditor` feeds a live preview computed with the
 * same math as the API (`sales-line-preview-math`); a saved, read-only
 * document shows the server's totals. `null` totals render the loading
 * shape — there is no other fallback.
 */
export interface DocumentTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal?: number;
  grandTotal: number;
}

const ROW_LABEL_KEY: Record<CommercialTotalsRowKey, MessageKey> = {
  subtotal: "sales.editor.totals.subtotal",
  discount: "sales.editor.totals.discount",
  tax: "sales.editor.totals.tax",
  shipping: "sales.editor.totals.shipping",
};

export function DocumentTotalsFooter({
  totals,
  isLoading,
  currency,
}: {
  totals: DocumentTotals | null;
  isLoading?: boolean;
  currency?: string;
}) {
  const { t } = useLocale();

  if (isLoading || !totals) {
    return <DocumentTotalsSkeleton />;
  }

  return (
    <DocumentTotalsBlock
      label={t("sales.editor.totals.grandTotal")}
      currency={currency}
      lines={commercialTotalsRows(totals).map((row) => ({
        key: row.key,
        label: t(ROW_LABEL_KEY[row.key]),
        value: row.value,
      }))}
      total={{
        key: "grandTotal",
        label: t("sales.editor.totals.grandTotal"),
        value: totals.grandTotal,
      }}
    />
  );
}
