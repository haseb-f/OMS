"use client";

import { Calculator } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsExpensesPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsExpenses"
      descriptionKey="reports.categories.expenses"
      breadcrumbKeys={["nav.reports", "nav.reportsExpenses"]}
      icon={Calculator}
    />
  );
}
