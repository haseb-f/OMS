"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { ChevronRight, Circle, Pin, PinOff } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { CompanySwitcher } from "./company-switcher";
import { cn } from "@/lib/utils";
import { EnterpriseBadge } from "@/components/ui/badge";
import { BrandMark } from "@/components/brand/brand-logo";
import { siteConfig } from "@/config/site";
import { navigationConfig } from "@/navigation/navigation.config";
import { buildNavigationTree, filterNavigationByAuth } from "@/navigation/build-navigation-tree";
import { iconRegistry, type IconName } from "@/navigation/icon-registry";
import type { NavigationItem } from "@/types/navigation";
import { useCurrentNavigation } from "@/hooks/use-current-navigation";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { MessageKey } from "@/i18n/translate";

function NavIcon({ name, compact = false }: { name?: IconName; compact?: boolean }) {
  // Every item needs an icon — in icon-collapsed mode a nav row shows only
  // the icon, so an icon-less item would otherwise clip to unreadable text.
  const className = compact ? "size-4" : "size-[18px]";
  if (!name) return <Circle className={className} strokeWidth={1.75} />;
  const Icon = iconRegistry[name];
  return <Icon className={className} strokeWidth={1.75} />;
}

export function AppSidebar() {
  const { t, direction } = useLocale();
  const { current } = useCurrentNavigation();
  const { permissions, isSuperAdmin, status } = useUserContext();

  // Sidebar must display only modules the user has permission to access
  // (ADR-0022 Part 4) — hidden modules never reach the render tree at all.
  // A super admin sees every module regardless of individual grants.
  // Permission filtering waits until auth is resolved: an empty permission
  // set during `loading` is unknown, not a denial (same contract as
  // `PermissionGate`). Collapse/expand still comes from SidebarProvider.
  const navigationTree = useMemo(
    () =>
      buildNavigationTree(
        filterNavigationByAuth(navigationConfig, permissions, {
          isSuperAdmin,
          accessReady: status === "authenticated",
        }),
      ),
    [permissions, isSuperAdmin, status],
  );

  // Strict accordion (ADR-0022, permanent): at most one module expanded at
  // a time. Expanding a module collapses whatever else was open; clicking
  // the already-open module collapses it, leaving zero expanded.
  const [expandedId, setExpandedId] = useLocalStorage<string | null>(
    STORAGE_KEYS.sidebarExpandedSection,
    null,
  );
  // isPinned/togglePin still drive the pin toggle on each sub-item, which
  // feeds the Dashboard's "Pinned Modules" widget — that widget is a
  // separate feature from the Sidebar (TASK-023A removed the Sidebar's own
  // Pinned/Recent sections, not pinning itself).
  const { isPinned, togglePin } = usePinnedItems();
  const { setOpenMobile, isMobile } = useSidebar();

  // The active route's parent module becomes the (only) expanded one
  // whenever the route changes.
  useEffect(() => {
    if (!current) return;
    const activeParentId = current.parent ?? (current.children ? current.id : undefined);
    if (activeParentId) setExpandedId(activeParentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const closeMobileOnNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  // shadcn's Sidebar positions itself with physical left/right CSS, not
  // logical properties — "Sidebar on the RIGHT" for Arabic requires
  // explicitly flipping `side`, not just setting `dir` on the document.
  return (
    <Sidebar collapsible="icon" variant="floating" side={direction === "rtl" ? "right" : "left"}>
      <SidebarHeader className="gap-1.5 p-2 pb-1.5">
        <div className="flex items-center gap-2 px-1 py-0.5 group-data-[collapsible=icon]:justify-center">
          <BrandMark />
          <span className="text-[13px] font-semibold tracking-[0.04em] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            {siteConfig.name}
          </span>
        </div>
        {/* The collapse toggle belongs to the Sidebar, directly below the logo — not the Topbar. */}
        <div className="px-1">
          <SidebarTrigger className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:justify-center" />
        </div>
      </SidebarHeader>

      <Separator className="mx-2 w-auto bg-sidebar-border" />

      {/* Context only, never a dashboard widget — kept compact so it never competes with navigation below. */}
      <div className="px-2 pt-1.5">
        <CompanySwitcher />
      </div>

      {/* Navigation starts immediately below the Company EnterpriseCard — no section
          title, no extra wrapper, no separator (TASK-023A). */}
      <SidebarContent className="px-2 pt-1.5">
        <SidebarMenu>
          {navigationTree.map((item) => (
            <NavTreeItem
              key={item.id}
              item={item}
              currentId={current?.id}
              expandedId={expandedId}
              onToggle={toggleExpanded}
              isPinned={isPinned}
              onTogglePin={togglePin}
              onNavigate={closeMobileOnNavigate}
              t={t}
            />
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}

function NavTreeItem({
  item,
  currentId,
  expandedId,
  onToggle,
  isPinned,
  onTogglePin,
  onNavigate,
  t,
}: {
  item: NavigationItem;
  currentId?: string;
  expandedId: string | null;
  onToggle: (id: string) => void;
  isPinned: (id: string) => boolean;
  onTogglePin: (id: string) => void;
  onNavigate: () => void;
  t: (key: MessageKey) => string;
}) {
  const hasChildren = !!item.children?.length;
  const isActive = currentId === item.id;
  const containsActive = hasChildren && item.children!.some((child) => child.id === currentId);
  const title = t(item.titleKey);

  if (!hasChildren) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={title}
          className={cn(
            isActive &&
              "bg-primary-soft font-semibold text-foreground shadow-xs before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-primary hover:bg-primary-soft",
          )}
        >
          <Link href={item.route ?? "#"} onClick={onNavigate}>
            <NavIcon name={item.icon} />
            <span className="group-data-[collapsible=icon]:hidden">{title}</span>
          </Link>
        </SidebarMenuButton>
        {item.badge && (
          <SidebarMenuBadge>
            <EnterpriseBadge
              variant={item.badge.variant ?? "default"}
              className="h-4 px-1.5 text-[10px]"
            >
              {item.badge.label}
            </EnterpriseBadge>
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  }

  const open = expandedId === item.id;

  return (
    <Collapsible open={open} onOpenChange={() => onToggle(item.id)}>
      <SidebarMenuItem
        className={cn(
          open &&
            "rounded-xl bg-sidebar-expanded py-1 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:py-0",
        )}
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={containsActive && !open}
            tooltip={title}
            className={cn(
              "group/trigger",
              containsActive &&
                !open &&
                "bg-primary-soft font-semibold text-foreground before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-primary",
            )}
          >
            <NavIcon name={item.icon} />
            <span className="group-data-[collapsible=icon]:hidden">{title}</span>
            <ChevronRight className="ms-auto size-3.5 shrink-0 transition-transform duration-(--duration-base) ease-(--ease-standard) group-data-[collapsible=icon]:hidden rtl:rotate-180 group-data-[state=open]/trigger:rotate-90 rtl:group-data-[state=open]/trigger:-rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children!.map((child) => {
              const childTitle = t(child.titleKey);
              return (
                <SidebarMenuSubItem key={child.id}>
                  <SidebarMenuSubButton asChild isActive={currentId === child.id}>
                    <Link href={child.route ?? "#"} onClick={onNavigate} className="group/pin">
                      <NavIcon name={child.icon} compact />
                      <span className="min-w-0 flex-1 truncate">{childTitle}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onTogglePin(child.id);
                        }}
                        className="shrink-0 opacity-0 group-hover/pin:opacity-100 hover:text-primary"
                        aria-label={
                          isPinned(child.id)
                            ? `${t("sidebar.unpin")} ${childTitle}`
                            : `${t("sidebar.pin")} ${childTitle}`
                        }
                      >
                        {isPinned(child.id) ? (
                          <PinOff className="size-3" />
                        ) : (
                          <Pin className="size-3" />
                        )}
                      </button>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
