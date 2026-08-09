import { MapPin } from "lucide-react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseBadge } from "@/components/ui/badge";

/** A formatted postal address with an optional label ("Billing", "Warehouse") and default marker. */
export function AddressCard({
  label,
  lines,
  isDefault,
  defaultLabel = "Default",
  className,
}: {
  label?: string;
  lines: string[];
  isDefault?: boolean;
  /** Pass a translated string — this component never hardcodes display text. */
  defaultLabel?: string;
  className?: string;
}) {
  return (
    <EnterpriseCard className={className}>
      <EnterpriseCardContent className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <MapPin className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          {(label || isDefault) && (
            <div className="flex items-center gap-2">
              {label && <span className="text-body font-medium">{label}</span>}
              {isDefault && (
                <EnterpriseBadge variant="secondary" className="text-[10px]">
                  {defaultLabel}
                </EnterpriseBadge>
              )}
            </div>
          )}
          <div className="flex flex-col text-caption text-muted-foreground">
            {lines.map((line, index) => (
              <span key={index}>{line}</span>
            ))}
          </div>
        </div>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
