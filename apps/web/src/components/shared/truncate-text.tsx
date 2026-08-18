"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Truncates long Arabic/Latin strings without breaking layout; full text stays on the tooltip. */
export function TruncateText({
  children,
  lines = 1,
  className,
}: {
  children: ReactNode;
  lines?: 1 | 2;
  className?: string;
}) {
  const text = typeof children === "string" ? children : undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-block w-max max-w-full min-w-0",
            lines === 1 ? "truncate" : "line-clamp-2 break-words",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      {text ? <TooltipContent className="max-w-xs text-start">{text}</TooltipContent> : null}
    </Tooltip>
  );
}
