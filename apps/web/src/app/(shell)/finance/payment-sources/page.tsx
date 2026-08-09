"use client";

import { CreditCard } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function FinancePaymentSourcesPage() {
  return (
    <ComingSoonPage
      titleKey="nav.financePaymentSources"
      breadcrumbKeys={["nav.finance", "nav.financePaymentSources"]}
      icon={CreditCard}
    />
  );
}
