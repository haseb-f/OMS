"use client";

import { Ship } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsShippingPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsShipping"
      descriptionKey="reports.categories.shipping"
      breadcrumbKeys={["nav.reports", "nav.reportsShipping"]}
      icon={Ship}
    />
  );
}
