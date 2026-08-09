"use client";

import { Printer } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function SettingsPrintSettingsPage() {
  return (
    <ComingSoonPage
      titleKey="nav.settingsPrintSettings"
      breadcrumbKeys={["nav.settings", "nav.settingsPrintSettings"]}
      icon={Printer}
    />
  );
}
