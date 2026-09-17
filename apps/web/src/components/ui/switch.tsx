"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Boolean toggle for a setting that takes effect immediately (a list's
 * "include archived", a rule's enabled flag). A value the user is *editing*
 * inside a form and saves later stays a `Checkbox` — the switch's instant-on
 * affordance would misrepresent it.
 *
 * The thumb translates on the logical axis (`rtl:-translate-x-*`) so the
 * control reads left-to-right in English and right-to-left in Arabic.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input shadow-inner transition-colors duration-[170ms] ease-(--ease-standard) outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:bg-input/60",
        "data-[state=checked]:bg-primary data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-3 rounded-full bg-background shadow-xs ring-0 transition-transform duration-[170ms] ease-(--ease-standard) motion-reduce:transition-none",
          "translate-x-0.5 rtl:-translate-x-0.5",
          "data-[state=checked]:translate-x-3.5 data-checked:translate-x-3.5",
          "data-[state=checked]:rtl:-translate-x-3.5 data-checked:rtl:-translate-x-3.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
