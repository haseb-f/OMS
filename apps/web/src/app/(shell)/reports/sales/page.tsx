"use client";

import { ShoppingCart } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsSalesPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsSales"
      descriptionKey="reports.categories.sales"
      breadcrumbKeys={["nav.reports", "nav.reportsSales"]}
      icon={ShoppingCart}
    />
  );
}
