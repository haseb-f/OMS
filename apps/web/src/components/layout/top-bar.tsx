"use client";

import Link from "next/link";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { CommandPalette } from "./command-palette";
import { QuickActionsMenu } from "./quick-actions-menu";
import { NotificationsMenu } from "./notifications-menu";
import { ThemeSwitch } from "./theme-switch";
import { LanguageSwitch } from "./language-switch";
import { ProfileMenu } from "./profile-menu";
import { useCurrentNavigation } from "@/hooks/use-current-navigation";
import { siteConfig } from "@/config/site";

/** The permanent top bar — one consistent layout for every page in the app. */
export function TopBar() {
  const { current, breadcrumb } = useCurrentNavigation();

  return (
    <header className="sticky top-0 z-(--z-topbar) flex flex-col border-b bg-background/80 backdrop-blur-sm">
      <div className="flex h-12 items-center gap-2 px-3">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />

        {breadcrumb.length > 0 ? (
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:block">
                <BreadcrumbLink asChild>
                  <Link href="/">{siteConfig.name}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {breadcrumb.map((item, index) => {
                const isLast = index === breadcrumb.length - 1;
                return (
                  <Fragment key={item.id}>
                    <BreadcrumbSeparator className="hidden sm:block" />
                    <BreadcrumbItem>
                      {isLast || !item.route ? (
                        <BreadcrumbPage>{item.title}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link href={item.route}>{item.title}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        ) : (
          <span className="text-sm font-medium">{siteConfig.name}</span>
        )}

        <div className="ms-auto flex items-center gap-1">
          <div className="hidden md:block">
            <CommandPalette />
          </div>
          <QuickActionsMenu />
          <NotificationsMenu />
          <ThemeSwitch />
          <LanguageSwitch />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ProfileMenu />
        </div>
      </div>

      {current && (current.title || current.subtitle) && (
        <div className="flex flex-col gap-0.5 px-4 pb-3 pt-1">
          <h1 className="text-page-title font-semibold tracking-tight">{current.title}</h1>
          {current.subtitle && (
            <p className="text-body text-muted-foreground">{current.subtitle}</p>
          )}
        </div>
      )}
    </header>
  );
}
