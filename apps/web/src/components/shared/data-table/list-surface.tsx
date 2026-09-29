"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Viewport-fill contract (design-system §6 "Scroll"). A list workspace that
 * opts in (`PageWorkspace dense` without `secondary`) provides `true`; on lg+
 * the shell then locks <main> to the viewport and every link of the chain
 * PageWorkspace → ListSurface → grid scroller is `flex-1 min-h-0`, so the
 * grid body is the ONE vertical scroller under a sticky header. Outside such
 * a workspace (detail tabs, dialogs, tree pages) everything keeps its
 * natural height and the page scrolls.
 */
const ViewportFillContext = createContext(false);

export function ViewportFillProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <ViewportFillContext.Provider value={value}>{children}</ViewportFillContext.Provider>;
}

/** True when the enclosing list workspace fills the viewport on lg+. */
export function useViewportFill() {
  return useContext(ViewportFillContext);
}

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
export function ListSurface({
  children,
  className,
  fill: fillRequested = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Flex to the remaining viewport height on lg+ (its content must then own
   * the vertical scroll — `EnterpriseDataTable` does). Only honoured inside a
   * viewport-fill workspace: a bare surface marking the shell viewport-fill
   * would clip whatever the page renders around it. Trees and boards whose
   * content is not its own scroller leave this off and keep natural height.
   */
  fill?: boolean;
}) {
  const fill = useViewportFill() && fillRequested;
  return (
    <div
      data-viewport-fill={fill ? "" : undefined}
      className={cn(
        // Contained data area: stronger edge than page chrome so tables read
        // as one card (toolbar + grid + footer), not floating rows on bg.
        "relative flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-table-surface",
        fill && "lg:min-h-0 lg:flex-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Filter/search strip pinned to the top of a `ListSurface`. `relative` so a bulk-action strip can overlay it in place. */
export function ListToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5 sm:px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Summary/pagination strip pinned to the bottom of a `ListSurface`. */
export function ListFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("shrink-0 border-t border-border bg-muted/20 px-3 py-1.5 sm:px-4", className)}
    >
      {children}
    </div>
  );
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
        "flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 sm:px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
