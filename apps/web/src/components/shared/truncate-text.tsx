"use client";

import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isElementOverflowing,
  useInOverflowTooltipRegion,
} from "@/components/shared/data-table/overflow-tooltip";
import { cn } from "@/lib/utils";

/**
 * Truncates long Arabic/Latin strings without breaking layout. The full text
 * is shown in a tooltip only when the text is actually clipped. Inside a
 * table (`OverflowTooltipRegion`) the region's single shared tooltip does
 * that; standalone, a tooltip opens on hover/focus after measuring.
 */
export function TruncateText({
  children,
  lines = 1,
  className,
}: {
  children: ReactNode;
  lines?: 1 | 2;
  className?: string;
}) {
  const inRegion = useInOverflowTooltipRegion();
  const [open, setOpen] = useState(false);
  const text = typeof children === "string" ? children : undefined;
  const boxClass = cn(
    "inline-block w-max max-w-full min-w-0 leading-normal",
    lines === 1 ? "truncate" : "line-clamp-2 break-words",
    className,
  );

  if (inRegion || !text) {
    return (
      <span data-overflow-tip={text ?? ""} className={boxClass}>
        {children}
      </span>
    );
  }

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <TooltipTrigger asChild>
        <span
          className={boxClass}
          onPointerEnter={(event) => setOpen(isElementOverflowing(event.currentTarget))}
          onFocus={(event) => setOpen(isElementOverflowing(event.currentTarget))}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-start">{text}</TooltipContent>
    </Tooltip>
  );
}
