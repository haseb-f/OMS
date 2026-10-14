"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { MANUAL_VOUCHER_VIEW_PERMISSION } from "./manual-voucher-list";

export type CustomerMoneyView = "receipts" | "refunds" | "other";

/**
 * The tabs of the customer-money page: receipts, refunds (`sales.refunds.view`)
 * and — R22 D4 — other receipts (`accounting.journal-entries.view`). Hidden when
 * only one view is available.
 */
export function CustomerMoneyTabs({
  view,
  onChange,
}: {
  view: CustomerMoneyView;
  onChange: (view: CustomerMoneyView) => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canViewRefunds = hasPermission("sales.refunds.view");
  const canViewOther = hasPermission(MANUAL_VOUCHER_VIEW_PERMISSION);
  if (!canViewRefunds && !canViewOther) return null;
  return (
    <Tabs value={view} onValueChange={(value) => onChange(value as CustomerMoneyView)}>
      <TabsList>
        <TabsTrigger value="receipts">{t("sales.refunds.tabs.receipts")}</TabsTrigger>
        {canViewRefunds ? (
          <TabsTrigger value="refunds">{t("sales.refunds.tabs.refunds")}</TabsTrigger>
        ) : null}
        {canViewOther ? (
          <TabsTrigger value="other">{t("vouchers.lists.otherReceipts")}</TabsTrigger>
        ) : null}
      </TabsList>
    </Tabs>
  );
}

export type SupplierMoneyView = "payments" | "other" | "transfers";

/**
 * R22 D4 — the tabs of the supplier-money page: supplier payments, other
 * payments and transfers between accounts (both `accounting.journal-entries.view`).
 */
export function SupplierMoneyTabs({
  view,
  onChange,
}: {
  view: SupplierMoneyView;
  onChange: (view: SupplierMoneyView) => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  if (!hasPermission(MANUAL_VOUCHER_VIEW_PERMISSION)) return null;
  return (
    <Tabs value={view} onValueChange={(value) => onChange(value as SupplierMoneyView)}>
      <TabsList>
        <TabsTrigger value="payments">{t("purchasing.payments.title")}</TabsTrigger>
        <TabsTrigger value="other">{t("vouchers.lists.otherPayments")}</TabsTrigger>
        <TabsTrigger value="transfers">{t("vouchers.lists.transfers")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
