"use client";

import { Bell } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function SettingsNotificationsPage() {
  return (
    <ComingSoonPage
      titleKey="nav.settingsNotifications"
      breadcrumbKeys={["nav.settings", "nav.settingsNotifications"]}
      icon={Bell}
    />
  );
}
