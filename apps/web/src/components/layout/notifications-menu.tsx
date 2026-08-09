"use client";

import { Bell } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/providers/locale-provider";

/** No notification-producing backend event exists yet — this is the shell wired up in advance, always showing the empty state. */
export function NotificationsMenu() {
  const { t } = useLocale();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <EnterpriseButton variant="ghost" size="icon-sm" aria-label={t("topbar.notifications")}>
          <Bell />
        </EnterpriseButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">{t("topbar.notifications")}</p>
        </div>
        <EmptyState
          icon={Bell}
          title={t("topbar.notificationsEmptyTitle")}
          description={t("topbar.notificationsEmptyDescription")}
        />
      </PopoverContent>
    </Popover>
  );
}
