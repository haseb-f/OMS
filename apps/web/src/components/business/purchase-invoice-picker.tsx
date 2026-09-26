"use client";

import { Receipt } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { cachedLookup } from "@/lib/lookup-cache";
import {
  purchaseInvoicesService,
  type PurchaseInvoiceRow,
} from "@/services/purchase-invoices-service";
import type { CurrencyRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

/** The subset a picker needs — enough to also display an invoice loaded from a document that only embeds `{id, invoiceNumber, status}`, not the full row. */
export type PurchaseInvoiceOption = Pick<PurchaseInvoiceRow, "id" | "invoiceNumber"> & {
  partner?: { name: string } | null;
  currency?: CurrencyRow | null;
};

/**
 * Landed Cost only attaches to the actual receipt event — a CONFIRMED
 * Purchase Invoice (ADR-0017, no separate Goods Receipt entity in this OMS).
 */
export function PurchaseInvoicePicker({
  value,
  onChange,
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  value: PurchaseInvoiceOption | null | undefined;
  onChange: (invoice: PurchaseInvoiceOption | null) => void;
  disabled?: boolean;
  /** Forwarded to the trigger so an external `<Label htmlFor>` / `FormControl` can name it. */
  id?: string;
  "aria-label"?: string;
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      id={id}
      triggerProps={{ "aria-label": ariaLabel }}
      value={value ?? null}
      onChange={onChange}
      onSearch={async (search) => {
        const params = { search: search || undefined, status: "CONFIRMED" as const, pageSize: 20 };
        const result = await cachedLookup(`purchase-invoices:${JSON.stringify(params)}`, () =>
          purchaseInvoicesService.list(params),
        );
        return result.items;
      }}
      getId={(invoice) => invoice.id}
      getTitle={(invoice) => invoice.invoiceNumber}
      getSubtitle={(invoice) => invoice.partner?.name ?? ""}
      placeholder={t("purchasing.landedCost.purchaseInvoicePicker.placeholder")}
      searchPlaceholder={t("purchasing.landedCost.purchaseInvoicePicker.searchPlaceholder")}
      emptyText={t("purchasing.landedCost.purchaseInvoicePicker.noResults")}
      disabled={disabled}
      allowClear
      icon={<Receipt className="size-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
