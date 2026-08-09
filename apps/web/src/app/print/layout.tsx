import type { ReactNode } from "react";

/**
 * The Enterprise Print Engine's isolated route group — deliberately a
 * sibling of `(shell)` and `(auth)`, not nested inside either, so pages
 * under `/print/*` never render `AppShell` (sidebar, top bar, breadcrumb).
 * This is what makes `window.print()` on these routes safe: there is
 * nothing on the page except the printable document itself.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="bg-white">{children}</div>;
}
