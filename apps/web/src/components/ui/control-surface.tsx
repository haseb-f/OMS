"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Where a selector control (select, combobox, date / month picker, calling-code
 * picker) is being used — the ONE switch between its two appearances
 * (design-system §12.23):
 *
 * - `toolbar` — the stronger blue-to-light-blue progression of table / report
 *   toolbars and filter rows (the default, and what `ListToolbar` /
 *   `SelectorRow` restore inside a dialog).
 * - `form` — a very light blue surface, dark text, subtle blue border, for data
 *   entry: create / edit forms, dialogs and sheets.
 *
 * Containers provide the surface; a control may override it with its own
 * `surface` prop. The shared trigger primitives turn it into
 * `data-surface`, which `theme/recipes.css` maps to the `--selector*` tokens —
 * so hover / open / selected / invalid / disabled / focus behave identically
 * in both. No page ever restyles a trigger, and no CSS keys on a route.
 */
export type ControlSurfaceName = "toolbar" | "form";

const ControlSurfaceContext = createContext<ControlSurfaceName>("toolbar");

export function ControlSurface({
  surface,
  children,
}: {
  surface: ControlSurfaceName;
  children: ReactNode;
}) {
  return (
    <ControlSurfaceContext.Provider value={surface}>{children}</ControlSurfaceContext.Provider>
  );
}

/** The surface the nearest container asks its selector controls to use. */
export function useControlSurface(): ControlSurfaceName {
  return useContext(ControlSurfaceContext);
}
