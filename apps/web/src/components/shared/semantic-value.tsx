import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SemanticValueKind = "email" | "phone" | "id" | "url" | "number" | "money" | "date";

/** Figures that are never truncated — a clipped amount is a wrong amount. */
const UNTRUNCATED_KINDS: ReadonlySet<SemanticValueKind> = new Set(["number", "money"]);

/** Kinds that read as digits: tabular figures in an isolated LTR run (`num`). */
const TABULAR_KINDS: ReadonlySet<SemanticValueKind> = new Set([
  "number",
  "money",
  "date",
  "id",
  "phone",
]);

/**
 * Values that must stay LTR inside an Arabic UI: emails, phones, IDs,
 * tracking numbers, URLs, figures, and dates. Labels remain RTL around them.
 * Digits use the `num` utility (tabular, isolated LTR) per design-system §2.
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
  return (
    <span
      dir="ltr"
      data-slot="semantic-value"
      data-kind={kind}
      className={cn(
        TABULAR_KINDS.has(kind) && "num",
        className,
        // Geometry is owned here — consumers must not force `display:block`
        // or the LTR run fills the RTL cell and leaves the header axis.
        "inline-block w-max min-w-0 [unicode-bidi:isolate]",
        UNTRUNCATED_KINDS.has(kind) ? "whitespace-nowrap" : "max-w-full truncate",
      )}
    >
      {children}
    </span>
  );
}
