"use client";

import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { DashboardLoading } from "@/components/dashboard/dashboard-loading";
import { useUserContext } from "@/providers/user-context";

/**
 * Role-relevant home: every panel is a real figure set from an existing
 * endpoint the user can access, gated by the same permissions as the lists
 * behind it. Users with nothing to show get their shortcuts instead. Until
 * the session's permissions are known the page shows skeletons — an unknown
 * permission set is never read as "nothing to show".
 */
export default function DashboardPage() {
  const { hasPermission, status } = useUserContext();
  if (status === "loading") return <DashboardLoading />;
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
