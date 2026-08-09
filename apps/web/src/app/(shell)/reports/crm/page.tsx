"use client";

import { Contact } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsCrmPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsCrm"
      descriptionKey="reports.categories.crm"
      breadcrumbKeys={["nav.reports", "nav.reportsCrm"]}
      icon={Contact}
    />
  );
}
