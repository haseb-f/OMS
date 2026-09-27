"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The record link a list row is opened from.
 *
 * The whole row navigates on click (see `getRowHref` in
 * `EnterpriseDataTable`), but the identity cell also renders as a real
 * anchor so middle-click, Ctrl+click and "copy link" work from the thing
 * that names the record — the checkbox, expand chevron and actions menu
 * keep their own independent click zones regardless. It reads as product
 * chrome rather than a document hyperlink: inherited colour at rest, primary
 * on hover, and a focus ring that survives being nested inside a clipped
 * table cell.
 *
 * No inline padding: under the cell's shrink-wrapped content box, a
 * padded link (even with matching negative margins) either steals width
 * from the reference — truncating it — or overflows the cell (review R7).
 */
export function RowIdentityLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-slot="row-identity-link"
      className={cn(
        "block min-w-0 max-w-full rounded-xs outline-none transition-colors duration-(--duration-base)",
        "hover:text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}
