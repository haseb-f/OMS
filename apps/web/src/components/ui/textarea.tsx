import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-sm border border-input bg-card px-3 py-1.5 text-body transition-[border-color,box-shadow] duration-(--duration-base) ease-(--ease-standard) outline-none placeholder:text-placeholder not-disabled:not-read-only:hover:border-foreground/45 focus-visible:border-focus-ring focus-visible:ring-1 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 read-only:cursor-default read-only:border-border read-only:bg-surface-sunken aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
