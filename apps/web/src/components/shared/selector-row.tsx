"use client";

import type { ComponentProps } from "react";
import { ControlSurface } from "@/components/ui/control-surface";
import { useToolbarTones } from "./data-table/toolbar-tones";

/**
 * A run of related selector controls outside a list toolbar — a report filter
 * bar, a line-item row, an inline editor with several selects. It numbers its
 * ordinary selector controls 1…5 in logical order exactly like `ListToolbar`
 * (design-system §12.15), so the row reads as one calm blue progression
 * (deepest step at the reading start; RTL/LTR mirror for free).
 *
 * Use it ONLY for controls that sit side by side as one row. Fields stacked in
 * a form grid, a lone picker or a dialog field are not a row: they keep the
 * single default shade (tone 3) and never change when a conditional field
 * appears. Pass `data-tone-exempt` on a control to keep it out of the count.
 */
export function SelectorRow({ children, ...props }: ComponentProps<"div">) {
  const ref = useToolbarTones<HTMLDivElement>();
  return (
    <div ref={ref} data-slot="selector-row" {...props}>
      <ControlSurface surface="toolbar">{children}</ControlSurface>
    </div>
  );
}
