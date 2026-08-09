import type { LucideIcon } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface QuickAction {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  variant?: "default" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
}

/** A row of labeled icon actions for a record's toolbar (Print, Duplicate, Archive, …). */
export function QuickActions({
  actions,
  className,
}: {
  actions: QuickAction[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {actions.map((action) => (
        <EnterpriseButton
          key={action.label}
          variant={action.variant ?? "outline"}
          size="sm"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          <action.icon />
          {action.label}
        </EnterpriseButton>
      ))}
    </div>
  );
}
