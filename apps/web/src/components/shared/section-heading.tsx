import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Section heading (design-system §12.5): a 16px title, an optional one-line
 * description, and an optional action at the logical end — the header of a
 * dashboard section or a card group. Headings describe the section; they
 * never repeat the page title.
 */
export function SectionHeading({
  title,
  description,
  action,
  id,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Pass an id to label the section (`aria-labelledby`). */
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-3 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-card-title">
          {title}
        </h2>
        {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
