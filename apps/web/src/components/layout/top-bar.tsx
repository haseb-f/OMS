"use client";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocale } from "@/providers/locale-provider";
import { CommandPalette } from "./command-palette";
import { NotificationsMenu } from "./notifications-menu";
import { ThemeSwitch } from "./theme-switch";
import { LocaleSwitch } from "./locale-switch";
import { ProfileMenu } from "./profile-menu";

/**
 * App Bar — sticky, solid, full-width. Search, Language, Theme,
 * Notifications, User. On viewports below `md`, a `SidebarTrigger` opens
 * the navigation Sheet (desktop collapse remains on the Sidebar chrome).
 */
export function TopBar() {
  const { t } = useLocale();

  return (
    <header className="sticky top-0 z-(--z-topbar) flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:h-14 sm:gap-3 sm:px-6">
      <SidebarTrigger
        className="ms-0.5 size-9 shrink-0 md:hidden"
        aria-label={t("topbar.openNavigation")}
      />

      <div className="min-w-0 max-w-md flex-1">
        <CommandPalette />
      </div>

      <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
        <LocaleSwitch />
        <ThemeSwitch />
        <NotificationsMenu />
        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:mx-1.5 sm:block" />
        <ProfileMenu />
      </div>
    </header>
  );
}
