"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import { DirectionProvider } from "./direction-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Single composition root for every app-wide provider — the root layout only ever imports this one component. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <DirectionProvider>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </DirectionProvider>
    </ThemeProvider>
  );
}
