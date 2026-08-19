"use client";

import { Separator } from "@/components/ui/separator";
import { CommandPalette } from "./command-palette";
import { NotificationsMenu } from "./notifications-menu";
import { ThemeSwitch } from "./theme-switch";
import { LocaleSwitch } from "./locale-switch";
import { ProfileMenu } from "./profile-menu";

/**
 * The application's App Bar (ADR-0021) — truly fixed/sticky, full width,
 * solid (never transparent/glass), with a clear bottom border so nothing
 * ever shows through while scrolling. Deliberately minimal: Search,
 * Language, Theme, Notifications, Current User. Nothing else. The
 * logo/brand mark and the collapse toggle belong to the Sidebar, not here.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-(--z-topbar) flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <div className="max-w-md flex-1">
        <CommandPalette />
      </div>

      <div className="ms-auto flex items-center gap-1.5">
        <LocaleSwitch />
        <ThemeSwitch />
        <NotificationsMenu />
        <Separator orientation="vertical" className="mx-1.5 h-5" />
        <ProfileMenu />
      </div>
    </header>
  );
}
