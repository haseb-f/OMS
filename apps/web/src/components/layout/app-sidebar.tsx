"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Circle, Pin, PinOff, Search as SearchIcon, X } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LogoMark } from "@/assets/logo-mark";
import { siteConfig } from "@/config/site";
import { navigationConfig } from "@/navigation/navigation.config";
import { buildNavigationTree, flattenNavigationTree } from "@/navigation/build-navigation-tree";
import { iconRegistry, type IconName } from "@/navigation/icon-registry";
import type { NavigationItem } from "@/types/navigation";
import { useCurrentNavigation } from "@/hooks/use-current-navigation";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const navigationTree = buildNavigationTree(navigationConfig);
const flatNavigation = flattenNavigationTree(navigationTree);

function NavIcon({ name }: { name?: IconName }) {
  // Every rendered item needs an icon: Pinned/Recent render leaf items as
  // top-level SidebarMenuButtons, which show icon-only in collapsed mode —
  // an icon-less item would otherwise clip to unreadable text there.
  if (!name) return <Circle />;
  const Icon = iconRegistry[name];
  return <Icon />;
}

export function AppSidebar() {
  const { current } = useCurrentNavigation();
  const [expandedId, setExpandedId] = useLocalStorage<string | null>(
    STORAGE_KEYS.sidebarExpandedSection,
    null,
  );
  const [search, setSearch] = useState("");
  const { isPinned, togglePin, pinnedIds } = usePinnedItems();
  const recentIds = useRecentPages();
  const { setOpenMobile, isMobile } = useSidebar();

  // "Only one parent expanded at a time" + "Automatic collapse": the active
  // route's section becomes the (only) expanded one whenever it changes.
  useEffect(() => {
    if (!current) return;
    const activeParentId = current.parent ?? (current.children ? current.id : undefined);
    if (activeParentId) setExpandedId(activeParentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const closeMobileOnNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;
  const searchResults = isSearching
    ? flatNavigation.filter((item) => item.route && item.title.toLowerCase().includes(query))
    : [];

  const pinnedItems = flatNavigation.filter((item) => item.route && pinnedIds.includes(item.id));
  const recentItems = recentIds
    .map((id) => flatNavigation.find((item) => item.id === id))
    .filter((item): item is NavigationItem => item !== undefined && item.id !== current?.id);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3">
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
          <LogoMark className="size-7 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            {siteConfig.name}
          </span>
        </div>
        <div className="px-2 group-data-[collapsible=icon]:hidden">
          <div className="relative">
            <SearchIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearch("");
              }}
              placeholder="Search menu…"
              className="h-8 ps-8 pe-7 text-sm"
              aria-label="Search menu"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {isSearching ? (
          <SidebarGroup>
            <SidebarGroupLabel>Results</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {searchResults.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">No matches.</p>
                ) : (
                  searchResults.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={current?.id === item.id}
                        tooltip={item.title}
                      >
                        <Link href={item.route!} onClick={closeMobileOnNavigate}>
                          <NavIcon name={item.icon} />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            {pinnedItems.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Pinned</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {pinnedItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={current?.id === item.id}
                          tooltip={item.title}
                        >
                          <Link href={item.route!} onClick={closeMobileOnNavigate}>
                            <NavIcon name={item.icon} />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {recentItems.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Recent</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {recentItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton asChild tooltip={item.title}>
                          <Link href={item.route!} onClick={closeMobileOnNavigate}>
                            <NavIcon name={item.icon} />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            <SidebarGroup>
              <SidebarGroupLabel>Modules</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationTree.map((item) => (
                    <NavTreeItem
                      key={item.id}
                      item={item}
                      currentId={current?.id}
                      expandedId={expandedId}
                      onExpand={setExpandedId}
                      isPinned={isPinned}
                      onTogglePin={togglePin}
                      onNavigate={closeMobileOnNavigate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
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
  onExpand,
  isPinned,
  onTogglePin,
  onNavigate,
}: {
  item: NavigationItem;
  currentId?: string;
  expandedId: string | null;
  onExpand: (id: string) => void;
  isPinned: (id: string) => boolean;
  onTogglePin: (id: string) => void;
  onNavigate: () => void;
}) {
  const hasChildren = !!item.children?.length;
  const isActive = currentId === item.id;
  const containsActive = hasChildren && item.children!.some((child) => child.id === currentId);

  if (!hasChildren) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
          <Link href={item.route ?? "#"} onClick={onNavigate}>
            <NavIcon name={item.icon} />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
        {item.badge && (
          <SidebarMenuBadge>
            <Badge variant={item.badge.variant ?? "default"} className="h-4 px-1.5 text-[10px]">
              {item.badge.label}
            </Badge>
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  }

  const open = expandedId === item.id;

  return (
    <Collapsible open={open} onOpenChange={(next) => next && onExpand(item.id)}>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={containsActive}
            tooltip={item.title}
            className="group/trigger"
          >
            <NavIcon name={item.icon} />
            <span>{item.title}</span>
            <ChevronRight className="ms-auto size-4 shrink-0 transition-transform duration-200 rtl:rotate-180 group-data-[state=open]/trigger:rotate-90 rtl:group-data-[state=open]/trigger:-rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children!.map((child) => (
              <SidebarMenuSubItem key={child.id}>
                <SidebarMenuSubButton asChild isActive={currentId === child.id}>
                  <Link href={child.route ?? "#"} onClick={onNavigate} className="group/pin">
                    <NavIcon name={child.icon} />
                    <span className="flex-1 truncate">{child.title}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onTogglePin(child.id);
                      }}
                      className="opacity-0 group-hover/pin:opacity-100 hover:text-primary"
                      aria-label={
                        isPinned(child.id) ? `Unpin ${child.title}` : `Pin ${child.title}`
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
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
