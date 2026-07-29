"use client";

import { Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useDirection } from "@/providers/direction-provider";

/**
 * Placeholder — no i18n/content translation system exists yet. Selecting
 * "العربية" only demonstrates the real RTL layout switch; no UI text is
 * actually translated.
 */
export function LanguageSwitch() {
  const { direction, setDirection } = useDirection();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change language">
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setDirection("ltr")}>
          <span className="flex-1">English</span>
          {direction === "ltr" && <span className="text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDirection("rtl")}>
          <span className="flex-1">العربية</span>
          {direction === "rtl" && <span className="text-xs text-muted-foreground">Active</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
