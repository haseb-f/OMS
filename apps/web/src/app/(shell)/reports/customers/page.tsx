"use client";

import { UsersRound } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function ReportsCustomersPage() {
  return (
    <ComingSoonPage
      titleKey="nav.reportsCustomers"
      descriptionKey="reports.categories.customers"
      icon={UsersRound}
    />
  );
}
