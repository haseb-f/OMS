import { isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function hasCellValue(value: ReactNode): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string" && (value.trim() === "" || value.trim() === "—")) return false;
  return true;
}

export function isStackedCellNode(node: ReactNode): boolean {
  return isValidElement(node) && node.type === StackedCell;
}

/**
 * Two-line identity block for operational tables — primary + related
 * secondary as one semantic unit. TableCell owns column padding and
 * alignment; this block adds neither. Missing values are omitted, never
 * faked as "—".
 *
 * Horizontal alignment is inherited from the cell (`text-start` /
 * `text-end`). Children must shrink-wrap (`inline-block w-max`) so LTR
 * IDs share the header axis instead of filling the cell as `dir=ltr`
 * blocks.
 */
export function StackedCell({
  primary,
  secondary,
  className,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  const showPrimary = hasCellValue(primary);
  const showSecondary = hasCellValue(secondary);
  if (!showPrimary && !showSecondary) return null;

  return (
    <div
      data-slot="stacked-cell"
      className={cn("flex min-w-0 max-w-full flex-col justify-center gap-0.5", className)}
    >
      {/* Line height comes from the type scale, never a tighter local override:
          these blocks sit inside cells that clip overflow, so a compressed box
          shaves the tops off Arabic glyphs instead of just tightening rhythm. */}
      {showPrimary ? (
        <div className="min-w-0 max-w-full font-medium text-foreground [&:not(:has([data-slot=badge]))]:text-body">
          {primary}
        </div>
      ) : null}
      {showSecondary ? (
        <div className="min-w-0 max-w-full text-caption text-muted-foreground">{secondary}</div>
      ) : null}
    </div>
  );
}
