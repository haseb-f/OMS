"use client";

import { FileText } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ExpensesProductCostPage() {
  return (
    <ComingSoonPage
      titleKey="nav.expensesProductCost"
      breadcrumbKeys={["nav.expenses", "nav.expensesProductCost"]}
      icon={FileText}
    />
  );
}
