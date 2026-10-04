import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { HomeTone } from "@/types/navigation";
import { cn } from "@/lib/utils";

/**
 * Home launcher tile (design-system §12.17): one destination, one click. A
 * module tile shows a larger icon chip, the title and a quiet caption (up to
 * three of its authorized pages); an action tile is the compact, one-line
 * variant. Colours, glass surface, hover and focus all live in the
 * `launcher-tile` recipe (`theme/recipes.css`) — a page only passes the tone.
 * The whole tile is ONE link, so keyboard focus and screen readers meet it
 * once; the caption is plain text, never a nested link.
 */
export function LauncherTile({
  href,
  title,
  caption,
  meta,
  icon: Icon,
  tone,
  size = "module",
  ariaLabel,
  className,
}: {
  href: string;
  title: string;
  caption?: ReactNode;
  /** A short trailing figure (e.g. a record count) — plain text, never a second link. */
  meta?: ReactNode;
  icon?: LucideIcon;
  tone: HomeTone;
  size?: "module" | "action";
  ariaLabel?: string;
  className?: string;
}) {
  const compact = size === "action";
  return (
    <Link
      href={href}
      data-slot="launcher-tile"
      data-tone={tone}
      data-size={size}
      aria-label={ariaLabel}
      className={cn(
        "group items-center gap-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring",
        compact ? "px-3 py-2.5" : "px-4 py-3.5",
        className,
      )}
    >
      {Icon ? (
        <span
          data-slot="launcher-icon"
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md",
            compact ? "size-8" : "size-11",
          )}
        >
          <Icon className={compact ? "size-4" : "size-5"} strokeWidth={1.9} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "min-w-0 text-pretty break-words text-foreground",
            compact ? "text-body font-medium" : "text-card-title font-semibold",
          )}
        >
          {title}
        </span>
        {caption && !compact ? (
          <span
            data-slot="launcher-caption"
            className="line-clamp-2 text-caption text-pretty break-words"
          >
            {caption}
          </span>
        ) : null}
      </span>
      {meta && !compact ? (
        <span
          data-slot="launcher-meta"
          className="num shrink-0 rounded-xs border border-border bg-surface-sunken px-1.5 py-0.5 text-caption font-medium text-foreground"
        >
          {meta}
        </span>
      ) : null}
      <ChevronRight
        data-slot="launcher-arrow"
        aria-hidden
        className="size-4 shrink-0 rtl:rotate-180"
      />
    </Link>
  );
}
