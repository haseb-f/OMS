"use client";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocale } from "@/providers/locale-provider";
import { BreadcrumbBar } from "./breadcrumb-bar";
import { CommandPalette } from "./command-palette";
import { NotificationsMenu } from "./notifications-menu";
import { ThemeSwitch } from "./theme-switch";
import { LocaleSwitch } from "./locale-switch";
import { ProfileMenu } from "./profile-menu";

/**
 * App Bar — sticky, solid, one 48px row (`--shell-topbar-height`) that
 * carries location AND global tools: [mobile nav] Back › Breadcrumb … Search,
 * Language, Theme, Notifications, User. Location lives here (not in a second
 * bar below) so page content starts high in the viewport. On viewports below
 * `lg` (phones and tablets), a `SidebarTrigger` opens the navigation Sheet (desktop collapse
 * remains on the Sidebar chrome).
 */
export function TopBar() {
  const { t } = useLocale();

  return (
    <header
      data-slot="top-bar"
      className="sticky top-0 z-(--z-topbar) flex h-(--shell-topbar-height) shrink-0 items-center gap-2 border-b border-border bg-card px-(--shell-gutter) lg:px-(--shell-gutter-lg)"
    >
      <SidebarTrigger
        className="-ms-1 size-8 shrink-0 lg:hidden"
        aria-label={t("topbar.openNavigation")}
      />

      <BreadcrumbBar />

      <div className="ms-auto flex shrink-0 items-center gap-1">
        <CommandPalette />
        <LocaleSwitch />
        <ThemeSwitch />
        <NotificationsMenu />
        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />
        <ProfileMenu />
      </div>
    </header>
  );
}
