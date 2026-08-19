import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The card geometry every list workspace shares.
 *
 * `EnterpriseDataTable` covers almost every list in OMS, but a few screens
 * cannot use it because their content is not a flat grid — the chart of
 * accounts and warehouse location trees, and the bank transaction matching
 * board. Those screens still have to *look* like every other list: same
 * radius, same border, same toolbar strip, same footer rule. Rendering them
 * through these primitives is what keeps that true when the tokens move,
 * instead of three hand-copied `rounded-xl border shadow-sm` wrappers that
 * silently fall a redesign behind.
 */
export function ListSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Filter/search strip pinned to the top of a `ListSurface`. */
export function ListToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Summary/pagination strip pinned to the bottom of a `ListSurface`. */
export function ListFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-t border-border px-5 py-2", className)}>{children}</div>;
}

/**
 * A filter strip that governs several tables at once, so it cannot live
 * inside any one of them — the balance sheet, income statement and account
 * statement each render multiple graded tables under a single set of
 * criteria. It is the same strip as `ListToolbar`, closed on all four sides,
 * so those reports still read as part of the same list system rather than as
 * loose controls floating above the content.
 */
export function FilterSurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-sm border border-border bg-card px-4 py-2 sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
