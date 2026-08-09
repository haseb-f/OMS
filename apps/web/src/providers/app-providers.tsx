"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import { LocaleProvider } from "./locale-provider";
import { AuthProvider } from "./auth-provider";
import { CompanyProvider } from "./company-provider";
import { UserContextProvider } from "./user-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/** Single composition root for every app-wide provider — the root layout only ever imports this one component. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <LocaleProvider>
        <AuthProvider>
          <CompanyProvider>
            <UserContextProvider>
              <TooltipProvider delayDuration={200}>
                {children}
                <Toaster />
              </TooltipProvider>
            </UserContextProvider>
          </CompanyProvider>
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
