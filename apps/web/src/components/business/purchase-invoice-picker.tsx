"use client";

import { Receipt } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
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
}: {
  value: PurchaseInvoiceOption | null | undefined;
  onChange: (invoice: PurchaseInvoiceOption | null) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={onChange}
      onSearch={async (search) => {
        const result = await purchaseInvoicesService.list({
          search: search || undefined,
          status: "CONFIRMED",
          pageSize: 20,
        });
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
