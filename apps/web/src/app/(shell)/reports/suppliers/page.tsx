"use client";

import { Truck } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsSuppliersPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsSuppliers"
      descriptionKey="reports.categories.suppliers"
      icon={Truck}
    />
  );
}
