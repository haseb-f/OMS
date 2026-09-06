import type { ReactNode } from "react";
import { detectTextDirection } from "@/lib/bidi";
import { cn } from "@/lib/utils";

/**
 * Prose cell/value that may be Arabic or Latin. Uses an explicit detected
 * direction so Arabic names/countries stay RTL + start-aligned while English
 * sources/names stay LTR — without forcing one direction globally.
 */
export function LocaleText({ children, className }: { children: ReactNode; className?: string }) {
  const text = typeof children === "string" ? children : null;
  const dir = text ? detectTextDirection(text) : "auto";

  return (
    <span
      dir={dir}
      data-slot="locale-text"
      className={cn(
        "inline-block w-max max-w-full min-w-0 truncate text-start [unicode-bidi:isolate]",
        className,
      )}
    >
      {children}
    </span>
  );
}
