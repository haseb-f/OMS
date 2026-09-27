import type { ReactNode } from "react";
import { CircleAlert, Inbox, ShieldAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateTone = "neutral" | "error" | "denied";

const DEFAULT_ICON: Record<EmptyStateTone, LucideIcon> = {
  neutral: Inbox,
  error: CircleAlert,
  denied: ShieldAlert,
};

const ICON_TONE: Record<EmptyStateTone, string> = {
  neutral: "text-muted-foreground",
  error: "text-destructive",
  denied: "text-destructive",
};

/**
 * The one empty / error / no-access panel (ErrorState and AccessDenied are
 * thin wrappers over it). Compact enterprise look: a small icon, the title
 * naming the state, one line of explanation, and at most one next action.
 *
 * - `tone="neutral"`: nothing here yet (the default).
 * - `tone="error"`: a failure — the title/description say what went wrong;
 *   announced to assistive tech (`role="alert"`).
 * - `tone="denied"`: the user lacks permission.
 * - `layout="page"`: fills and centers inside a page body (full-page gates).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
  layout = "inline",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: EmptyStateTone;
  layout?: "inline" | "page";
  className?: string;
}) {
  const Icon = icon ?? DEFAULT_ICON[tone];
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      data-tone={tone}
      className={cn(
        "flex flex-col items-center gap-2 px-4 text-center",
        layout === "page" ? "flex-1 justify-center py-16" : "py-8",
        className,
      )}
    >
      <Icon className={cn("size-5 shrink-0", ICON_TONE[tone])} strokeWidth={1.75} aria-hidden />
      <div className="flex max-w-md flex-col gap-0.5">
        <p className="text-card-title text-foreground">{title}</p>
        {description && <p className="text-caption text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
