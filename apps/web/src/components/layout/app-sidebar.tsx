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
import { CompanySwitcher } from "./company-switcher";
import { cn } from "@/lib/utils";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseButton } from "@/components/ui/button";
import { BrandMark } from "@/components/brand/brand-logo";
import { siteConfig } from "@/config/site";
import { NAVIGATION_GROUPS, navigationConfig } from "@/navigation/navigation.config";
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
  const className = compact ? "size-3.5" : "size-4";
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
  // Permission filtering waits only for the initial `loading` bootstrap
  // window (an empty permission set there is unknown, not a denial — same
  // contract as `PermissionGate`); `error` must NOT skip filtering the same
  // way, or a flaky `/auth/me` call (a real risk on a live network — cold
  // start, timeout, transient 5xx) would fail OPEN into the full, unfiltered
  // navigation indefinitely instead of failing closed. Collapse/expand still
  // comes from SidebarProvider.
  const authorizedItems = useMemo(
    () =>
      filterNavigationByAuth(navigationConfig, permissions, {
        isSuperAdmin,
        accessReady: status !== "loading",
      }),
    [permissions, isSuperAdmin, status],
  );

  // Until `/auth/me` resolves, `accessReady` is false and the line above
  // yields the FULL config — which used to render every module and then
  // visibly shrink to the permitted subset a moment later. Replaying the
  // module set this browser was last authorized for removes that jump while
  // keeping the sidebar populated from the first paint. It is presentation
  // only: `PermissionGate` still guards every route, so a stale cache can
  // never grant access to anything.
  const [lastAuthorizedIds, setLastAuthorizedIds] = useLocalStorage<string[] | null>(
    STORAGE_KEYS.sidebarAuthorizedItems,
    null,
  );

  const navigationTree = useMemo(() => {
    if (status === "authenticated" || !lastAuthorizedIds?.length) {
      return buildNavigationTree(authorizedItems);
    }
    const allowed = new Set(lastAuthorizedIds);
    return buildNavigationTree(authorizedItems.filter((item) => allowed.has(item.id)));
  }, [authorizedItems, lastAuthorizedIds, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const ids = authorizedItems.map((item) => item.id);
    setLastAuthorizedIds((previous) =>
      previous?.length === ids.length && previous.every((id, index) => id === ids[index])
        ? previous
        : ids,
    );
  }, [status, authorizedItems, setLastAuthorizedIds]);

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
    <Sidebar
      collapsible="icon"
      variant="floating"
      side={direction === "rtl" ? "right" : "left"}
      dir={direction}
    >
      {/* One header row the height of the TopBar: brand + desktop collapse
          toggle (mobile open/close lives on TopBar + Sheet). */}
      <SidebarHeader className="h-(--shell-topbar-height) shrink-0 flex-row items-center gap-2 border-b border-sidebar-border px-3 py-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <BrandMark />
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          {siteConfig.name}
        </span>
        <SidebarTrigger className="hidden size-7 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:inline-flex group-data-[collapsible=icon]:hidden" />
      </SidebarHeader>

      {/* Context only, never a dashboard widget — kept compact so it never competes with navigation below. */}
      <div className="px-2 pt-2 group-data-[collapsible=icon]:px-1">
        <CompanySwitcher />
      </div>

      <SidebarContent className="px-2 pt-1 pb-2 group-data-[collapsible=icon]:px-1">
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

      {/* Icon-collapsed mode keeps an expand control reachable at the bottom. */}
      <SidebarFooter className="hidden border-t border-sidebar-border p-1 lg:group-data-[collapsible=icon]:flex">
        <SidebarTrigger className="mx-auto size-8 text-sidebar-muted-foreground hover:bg-sidebar-accent" />
      </SidebarFooter>
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
              "bg-sidebar-active font-semibold text-sidebar-primary [&_svg]:text-sidebar-rail before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-full before:bg-sidebar-rail before:shadow-[0_0_10px_1px_var(--sidebar-rail-glow)] hover:bg-sidebar-active",
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
              className="h-4 px-1 text-micro"
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
      <SidebarMenuItem className={cn(open && "pb-1 group-data-[collapsible=icon]:pb-0")}>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={containsActive && !open}
            tooltip={title}
            className={cn(
              "group/trigger",
              containsActive &&
                !open &&
                "bg-sidebar-active font-semibold text-sidebar-primary [&_svg]:text-sidebar-rail before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-full before:bg-sidebar-rail before:shadow-[0_0_10px_1px_var(--sidebar-rail-glow)]",
            )}
          >
            <NavIcon name={item.icon} />
            <span className="group-data-[collapsible=icon]:hidden">{title}</span>
            <ChevronRight className="ms-auto size-3.5 shrink-0 transition-transform duration-(--duration-base) ease-(--ease-standard) group-data-[collapsible=icon]:hidden rtl:rotate-180 group-data-[state=open]/trigger:rotate-90 rtl:group-data-[state=open]/trigger:-rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {groupChildren(item.children!).map((child, index, list) => {
              const childTitle = t(child.titleKey);
              const groupHeading =
                child.group && child.group !== list[index - 1]?.group
                  ? t(NAVIGATION_GROUPS[child.group].titleKey)
                  : null;
              return (
                <SidebarMenuSubItem key={child.id}>
                  {groupHeading ? (
                    <div
                      role="presentation"
                      className="px-2.5 pt-2 pb-0.5 text-micro text-sidebar-muted-foreground first:pt-0.5"
                    >
                      {groupHeading}
                    </div>
                  ) : null}
                  <SidebarMenuSubButton asChild isActive={currentId === child.id}>
                    <Link href={child.route ?? "#"} onClick={onNavigate} className="group/pin">
                      <NavIcon name={child.icon} compact />
                      {/* Wrap to a second line instead of truncating (R2-09) — English
                          labels like "Purchasing Reports" must stay whole. */}
                      <span className="line-clamp-2 min-w-0 flex-1 break-words">{childTitle}</span>
                      <EnterpriseButton
                        type="button"
                        variant="ghost"
                        size="icon-xs"
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
                      </EnterpriseButton>
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

/** Stable-sorts a section's children by their navigation group (ungrouped first). */
function groupChildren(children: NavigationItem[]): NavigationItem[] {
  if (!children.some((child) => child.group)) return children;
  return children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const ga = a.child.group ? NAVIGATION_GROUPS[a.child.group].order : -1;
      const gb = b.child.group ? NAVIGATION_GROUPS[b.child.group].order : -1;
      return ga - gb || a.index - b.index;
    })
    .map(({ child }) => child);
}
