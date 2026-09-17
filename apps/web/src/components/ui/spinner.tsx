import type { ComponentProps } from "react";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

function Spinner({ className, "aria-hidden": ariaHidden, ...props }: ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role={ariaHidden ? undefined : "status"}
      aria-label={ariaHidden ? undefined : "Loading"}
      aria-hidden={ariaHidden}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Spinner };
