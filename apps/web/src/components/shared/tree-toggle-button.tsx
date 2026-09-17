"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import { EnterpriseButton } from "@/components/ui/button";

/** Shared expand/collapse control for tree rows (chart of accounts, locations). */
export function TreeToggleButton({
  expanded,
  onClick,
  expandLabel,
  collapseLabel,
}: {
  expanded: boolean;
  onClick: () => void;
  expandLabel: string;
  collapseLabel: string;
}) {
  return (
    <EnterpriseButton
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-5 shrink-0 text-muted-foreground"
      aria-expanded={expanded}
      aria-label={expanded ? collapseLabel : expandLabel}
      onClick={onClick}
    >
      {expanded ? (
        <ChevronDown className="size-4" />
      ) : (
        <ChevronRight className="size-4 rtl:rotate-180" />
      )}
    </EnterpriseButton>
  );
}
