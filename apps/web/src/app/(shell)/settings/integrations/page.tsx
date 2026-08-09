"use client";

import { Plug } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/coming-soon-page";

export default function SettingsIntegrationsPage() {
  return (
    <ComingSoonPage
      titleKey="nav.settingsIntegrations"
      breadcrumbKeys={["nav.settings", "nav.settingsIntegrations"]}
      icon={Plug}
    />
  );
}
