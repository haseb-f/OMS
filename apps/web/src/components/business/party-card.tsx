import type { LucideIcon } from "lucide-react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge, type StatusTone } from "./status-badge";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2))?.toUpperCase();
}

/**
 * Shared layout behind CustomerCard/SupplierCard — a compact "who is this
 * party" summary tile: avatar, name, code, one contact line, status.
 */
export function PartyCard({
  name,
  code,
  contact,
  icon: Icon,
  status,
  statusTone = "neutral",
  className,
}: {
  name: string;
  code?: string;
  contact?: string;
  icon?: LucideIcon;
  status?: string;
  statusTone?: StatusTone;
  className?: string;
}) {
  return (
    <EnterpriseCard className={className}>
      <EnterpriseCardContent className="flex items-center gap-3">
        <Avatar size="lg">
          <AvatarFallback>{Icon ? <Icon className="size-4" /> : initials(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-card-title">{name}</span>
            {status && <StatusBadge label={status} tone={statusTone} />}
          </div>
          <span className="truncate text-caption text-muted-foreground">
            {code}
            {code && contact && " · "}
            {contact}
          </span>
        </div>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}

export function CustomerCard(props: Omit<Parameters<typeof PartyCard>[0], "icon">) {
  return <PartyCard {...props} />;
}

export function SupplierCard(props: Omit<Parameters<typeof PartyCard>[0], "icon">) {
  return <PartyCard {...props} />;
}
