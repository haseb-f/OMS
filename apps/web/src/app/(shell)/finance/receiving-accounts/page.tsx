"use client";

import { Landmark } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function FinanceReceivingAccountsPage() {
  return (
    <ComingSoonPage
      titleKey="nav.financeReceivingAccounts"
      breadcrumbKeys={["nav.finance", "nav.financeReceivingAccounts"]}
      icon={Landmark}
    />
  );
}
