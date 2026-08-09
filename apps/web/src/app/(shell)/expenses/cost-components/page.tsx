"use client";

import { Calculator } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ExpensesCostComponentsPage() {
  return (
    <ComingSoonPage
      titleKey="nav.expensesComponents"
      breadcrumbKeys={["nav.expenses", "nav.expensesComponents"]}
      icon={Calculator}
    />
  );
}
