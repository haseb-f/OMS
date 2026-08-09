import type { ReactNode } from "react";
import type { PrintOrientation } from "@/types/print-engine";

/**
 * The outer shell every print template renders through — sets the physical
 * `@page` size/margins and reserves bottom space for `PrintFooter` (which
 * repeats on every sheet via `position: fixed`, a standard print CSS
 * technique). A printed document is never theme-aware: it always renders
 * black-on-white regardless of the app's live light/dark theme, so this
 * component (and everything under `components/print/`) intentionally uses
 * fixed neutral colors instead of the on-screen design tokens.
 */
export function PrintPage({
  orientation,
  children,
}: {
  orientation: PrintOrientation;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white px-[12mm] pt-[12mm] pb-[22mm] text-slate-900">
      {/* `@page` is document-scoped by spec — safe here because this route renders nothing else. */}
      <style>{`
        @page {
          size: A4 ${orientation};
          margin: 12mm;
        }
        html, body {
          background: #fff;
        }
        @media print {
          .print-page-counter::after {
            content: "Page " counter(page) " of " counter(pages);
          }
        }
      `}</style>
      {children}
    </div>
  );
}
