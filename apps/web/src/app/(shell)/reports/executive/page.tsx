"use client";

import { BarChart3 } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsExecutivePage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsExecutive"
      descriptionKey="reports.categories.executive"
      icon={BarChart3}
    />
  );
}
