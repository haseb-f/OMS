"use client";

import { SlidersHorizontal } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function SettingsGeneralPage() {
  return (
    <ComingSoonPage
      titleKey="nav.settingsGeneral"
      breadcrumbKeys={["nav.settings", "nav.settingsGeneral"]}
      icon={SlidersHorizontal}
    />
  );
}
