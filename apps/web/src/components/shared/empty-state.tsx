import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared empty / sparse-state pattern — compact, no decorative icon well. */
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
    <div className={cn("flex flex-col items-center gap-3 px-4 py-8 text-center", className)}>
      <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-5" strokeWidth={1.75} />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-body font-semibold">{title}</p>
        {description && <p className="text-caption text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
