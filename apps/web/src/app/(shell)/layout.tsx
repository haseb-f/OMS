import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";

/** Reads the sidebar's persisted state server-side to avoid a flash of the wrong state on load. */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return <AppShell defaultSidebarOpen={defaultSidebarOpen}>{children}</AppShell>;
}
