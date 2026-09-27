import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { NavigationTrail } from "./navigation-trail";
import { RouteAccessGuard } from "./route-access-guard";

/**
 * The permanent OMS application shell: Sidebar / Topbar (location + global
 * tools) / Page Content. Every future business page renders as `children`
 * (using its own `PageHeader` for Title/Subtitle/Actions) — this component
 * itself never changes when a new module is added (see navigation.config.ts).
 * Dimensions come from the shell tokens in `theme/tokens.css`.
 */
export function AppShell({
  children,
  defaultSidebarOpen,
}: {
  children: ReactNode;
  defaultSidebarOpen: boolean;
}) {
  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-x-hidden bg-background">
        <TopBar />
        {/* `SidebarInset` is the page's one <main> landmark. A list workspace
            marks itself `data-viewport-fill`: on desktop the
            page then locks to the viewport and the grid body becomes the ONE
            scroller (sticky header, no nested page+table scroll). Phones and
            tablets keep normal page scroll with the card list. */}
        <div className="flex min-w-0 flex-1 justify-center overflow-x-hidden lg:has-[[data-viewport-fill]]:h-[calc(100dvh-var(--shell-topbar-height))] lg:has-[[data-viewport-fill]]:flex-none lg:has-[[data-viewport-fill]]:overflow-y-hidden">
          <div className="flex w-full min-w-0 max-w-(--shell-content-max) flex-1 flex-col gap-3 px-(--shell-gutter) pt-3 pb-6 lg:min-h-0 lg:px-(--shell-gutter-lg) lg:pt-4 lg:has-[[data-viewport-fill]]:pb-4">
            <NavigationTrail />
            <RouteAccessGuard>{children}</RouteAccessGuard>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
