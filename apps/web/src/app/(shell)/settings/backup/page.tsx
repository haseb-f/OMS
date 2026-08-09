"use client";

import { HardDrive } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function SettingsBackupPage() {
  return (
    <ComingSoonPage
      titleKey="nav.settingsBackup"
      breadcrumbKeys={["nav.settings", "nav.settingsBackup"]}
      icon={HardDrive}
    />
  );
}
