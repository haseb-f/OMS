import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-xs border border-input bg-card px-3 py-1.5 text-body shadow-xs transition-[border-color,box-shadow] duration-[170ms] ease-(--ease-standard) outline-none placeholder:text-muted-foreground/80 not-disabled:not-read-only:hover:border-foreground/30 focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--ring)] focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 read-only:cursor-default read-only:bg-muted/50 read-only:opacity-90 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
