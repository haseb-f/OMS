import type { ReactNode } from "react";
import { InvestorPortalAuthProvider } from "@/providers/investor-portal-auth-provider";

/**
 * Shared wrapper for the entire Investor Portal (`/investor/*`) — provides
 * ONLY the Portal's own auth context, deliberately never `AppShell`/the
 * admin sidebar (mission Part 25/26). Public screens (`(public)`) and the
 * authenticated app (`(app)`) each bring their own visual layout below this.
 */
export default function InvestorPortalRootLayout({ children }: { children: ReactNode }) {
  return <InvestorPortalAuthProvider>{children}</InvestorPortalAuthProvider>;
}
