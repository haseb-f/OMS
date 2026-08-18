import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SemanticValueKind = "email" | "phone" | "id" | "url" | "number" | "money";

/**
 * Values that must stay LTR inside an Arabic UI: emails, phones, IDs,
 * tracking numbers, URLs, and figures. Labels remain RTL around them.
 */
export function SemanticValue({
  kind,
  children,
  className,
}: {
  kind: SemanticValueKind;
  children: ReactNode;
  className?: string;
}) {
  const numeric = kind === "number" || kind === "money";

  return (
    <span
      dir="ltr"
      data-slot="semantic-value"
      className={cn(
        numeric ? "tabular-nums" : "font-mono",
        className,
        // Geometry is owned here — consumers must not force `display:block`
        // or the LTR run fills the RTL cell and leaves the header axis.
        "inline-block w-max max-w-full min-w-0 truncate [unicode-bidi:isolate]",
      )}
    >
      {children}
    </span>
  );
}
