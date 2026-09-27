import { isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function hasCellValue(value: ReactNode): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string" && (value.trim() === "" || value.trim() === "—")) return false;
  return true;
}

/**
 * One bidi-isolated line of cell text: a shrink-wrapped `<bdi>` takes its
 * direction from its own content, so "22 Sep 2026" or "2,000.00 USD" never
 * reorders inside an Arabic row (design-system §2), a long Latin value clips
 * at its own end, and the box itself still sits where the cell aligns it.
 */
export const bidiLineClass = "inline-block w-max max-w-full min-w-0 truncate align-top";

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
 *
 * Each line is a shrink-wrapped `<bdi>` ({@link bidiLineClass}), so a plain
 * "22 Sep 2026" or "2,000.00 USD" never reorders inside an Arabic row
 * (design-system §2) while the line still aligns with the cell.
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
      className={cn(
        // Top-align inline-level descendants: baseline-aligned inline-blocks
        // (LTR-isolated IDs, phones) otherwise stretch each line box by ~6px.
        "flex min-w-0 max-w-full flex-col justify-center gap-0 [&_*]:align-top",
        className,
      )}
    >
      {/* Two lines maximum (design-system §6): each line clips on the inline
          axis. Line height comes from the type scale, never a tighter local
          override — these blocks sit inside cells that clip overflow, so a
          compressed box shaves the tops off Arabic glyphs. Hierarchy is
          weight + color, not size: primary `font-medium text-foreground`,
          secondary `text-caption text-muted-foreground`. */}
      {showPrimary ? (
        <div className="min-w-0 max-w-full truncate font-medium text-foreground [&:not(:has([data-slot=badge]))]:text-table">
          <bdi data-overflow-tip="" className={bidiLineClass}>
            {primary}
          </bdi>
        </div>
      ) : null}
      {showSecondary ? (
        <div className="min-w-0 max-w-full truncate text-caption text-muted-foreground">
          <bdi data-overflow-tip="" className={bidiLineClass}>
            {secondary}
          </bdi>
        </div>
      ) : null}
    </div>
  );
}
