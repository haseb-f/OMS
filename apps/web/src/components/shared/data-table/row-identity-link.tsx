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
        "-mx-1 block min-w-0 max-w-full rounded-xs px-1 outline-none transition-colors duration-(--duration-base)",
        "hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
    >
      {children}
    </Link>
  );
}
