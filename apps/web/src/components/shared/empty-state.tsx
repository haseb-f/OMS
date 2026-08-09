import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Generic empty-state pattern — reused anywhere a list/panel has nothing to show yet (notifications, future data tables, etc.). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-4 px-4 py-14 text-center", className)}>
      <div className="relative flex size-20 items-center justify-center rounded-full bg-linear-to-b from-muted to-muted/40 ring-8 ring-muted/30">
        <Icon className="size-8 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-body font-semibold">{title}</p>
        {description && (
          <p className="max-w-sm text-caption text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
