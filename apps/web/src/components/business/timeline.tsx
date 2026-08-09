import type { LucideIcon } from "lucide-react";
import { Check, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TimelineEntry {
  id: string;
  title: string;
  description?: string;
  /** Pre-formatted display string — this component never does date math. */
  timestamp?: string;
  actor?: string;
  icon?: LucideIcon;
  status?: "done" | "pending" | "rejected";
}

const statusIcon: Record<NonNullable<TimelineEntry["status"]>, LucideIcon> = {
  done: Check,
  pending: Clock,
  rejected: X,
};

const statusClasses: Record<NonNullable<TimelineEntry["status"]>, string> = {
  done: "bg-success/10 text-success",
  pending: "bg-muted text-muted-foreground",
  rejected: "bg-destructive/10 text-destructive",
};

/**
 * The one vertical timeline every business module uses for history/approval
 * trails — ActivityFeed, AuditTimeline, and ApprovalTimeline (below) are all
 * this same component with a different entry shape, never a re-implementation.
 */
export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {entries.map((entry, index) => {
        const Icon = entry.status ? statusIcon[entry.status] : entry.icon;
        const isLast = index === entries.length - 1;
        return (
          <li key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  entry.status ? statusClasses[entry.status] : "bg-muted text-muted-foreground",
                )}
              >
                {Icon ? (
                  <Icon className="size-4" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              {!isLast && <span className="my-1 w-px flex-1 bg-border" />}
            </div>
            <div className={cn("flex flex-1 flex-col gap-0.5", !isLast && "pb-5")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium">{entry.title}</span>
                {entry.timestamp && (
                  <span className="text-caption text-muted-foreground">{entry.timestamp}</span>
                )}
              </div>
              {entry.description && (
                <p className="text-caption text-muted-foreground">{entry.description}</p>
              )}
              {entry.actor && (
                <span className="text-caption text-muted-foreground">— {entry.actor}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Semantic alias for a generic "what happened" feed (comments, status changes, notes). */
export const ActivityFeed = Timeline;

/** Semantic alias for a record's change history — pass `actor` on every entry. */
export const AuditTimeline = Timeline;

/** Semantic alias for a multi-step approval chain — pass `status` on every entry. */
export const ApprovalTimeline = Timeline;
