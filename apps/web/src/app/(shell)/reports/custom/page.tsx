"use client";

import { FileText } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsCustomPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsCustom"
      descriptionKey="reports.categories.custom"
      breadcrumbKeys={["nav.reports", "nav.reportsCustom"]}
      icon={FileText}
    />
  );
}
