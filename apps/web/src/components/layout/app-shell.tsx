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
      <SidebarInset>
        <TopBar />
        <BreadcrumbBar />
        <main className="flex flex-1 justify-center">
          <div className="flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 pt-1 pb-8 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
