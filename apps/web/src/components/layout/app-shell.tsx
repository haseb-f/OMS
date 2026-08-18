import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";
import { BreadcrumbBar } from "./breadcrumb-bar";

/**
 * The permanent OMS application shell: Sidebar / Topbar / Breadcrumb / Page
 * Content. Every future business page renders as `children` (using its own
 * `PageHeader` for Title/Subtitle/Actions/Filters) — this component itself
 * never changes when a new module is added (see navigation.config.ts).
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
      <SidebarInset className="min-w-0 overflow-x-hidden">
        <TopBar />
        <BreadcrumbBar />
        <main className="flex min-w-0 flex-1 justify-center overflow-x-hidden">
          <div className="flex min-w-0 w-full max-w-[1400px] flex-1 flex-col gap-3 px-4 pt-2 pb-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
