"use client";

import { Layers } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsAnalyticsPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsAnalytics"
      descriptionKey="reports.categories.analytics"
      breadcrumbKeys={["nav.reports", "nav.reportsAnalytics"]}
      icon={Layers}
    />
  );
}
