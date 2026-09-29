"use client";

import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { useUserContext } from "@/providers/user-context";

/**
 * Role-relevant home: every panel is a real figure set from an existing
 * endpoint the user can access, gated by the same permissions as the lists
 * behind it. Users with nothing to show get their shortcuts instead.
 */
export default function DashboardPage() {
  const { hasPermission } = useUserContext();
  return (
    <DashboardOverview
      access={{
        sales: hasPermission("crm.leads.view") || hasPermission("store-orders.view"),
        leads: hasPermission("crm.leads.view"),
        paymentReview: hasPermission("sales.receipts.view"),
        bank: hasPermission("accounting.bank-transactions.view"),
      }}
    />
  );
}
