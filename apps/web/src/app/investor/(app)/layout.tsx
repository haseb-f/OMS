"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { EnterpriseButton } from "@/components/ui/button";
import { LocaleSwitch } from "@/components/layout/locale-switch";
import { useInvestorPortalAuth } from "@/providers/investor-portal-auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/investor/dashboard", labelKey: "investorPortal.nav.dashboard" as const },
  { href: "/investor/investments", labelKey: "investorPortal.nav.investments" as const },
  { href: "/investor/profits", labelKey: "investorPortal.nav.profits" as const },
  { href: "/investor/statement", labelKey: "investorPortal.nav.statement" as const },
  { href: "/investor/documents", labelKey: "investorPortal.nav.documents" as const },
  { href: "/investor/account", labelKey: "investorPortal.nav.account" as const },
];

/**
 * Investor Portal's own minimal navigation shell (mission Part 25/26/27) —
 * a single top nav bar, deliberately NOT `AppShell`/the admin sidebar. Kept
 * intentionally small: six links, no nested menus, no admin-style density.
 */
export default function InvestorPortalAppLayout({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const { status, logout } = useInvestorPortalAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (status === "loading") {
    return <div className="flex min-h-svh items-center justify-center bg-background" />;
  }

  if (status === "unauthenticated") {
    // Defense in depth — `proxy.ts` already redirects at the edge; this
    // covers the moment before that navigation lands on an already-open tab.
    router.replace("/investor/login");
    return null;
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/investor/dashboard" className="flex shrink-0 items-center gap-2">
            <BrandLogo variant="mark" sizes="28px" className="size-7" />
            <span className="hidden text-sm font-semibold text-foreground sm:inline">
              {t("investorPortal.auth.loginTitle")}
            </span>
          </Link>

          <nav className="scrollbar-none flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "shrink-0 rounded-sm px-3 py-1.5 text-caption font-medium whitespace-nowrap transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <LocaleSwitch />
            <EnterpriseButton
              variant="ghost"
              size="icon-sm"
              aria-label={t("investorPortal.nav.logout")}
              onClick={logout}
            >
              <LogOut />
            </EnterpriseButton>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
