"use client";

import { ShoppingBag } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsPurchasingPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsPurchasing"
      descriptionKey="reports.categories.purchasing"
      breadcrumbKeys={["nav.reports", "nav.reportsPurchasing"]}
      icon={ShoppingBag}
    />
  );
}
