import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardDescription,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Compact financial stat tile — the Dashboard/Statement summary building block. Never combines Capital and Profit in one figure (mission Part 28/40). */
export function PortalStatCard({
  label,
  value,
  currencyCode,
  tone = "default",
}: {
  label: string;
  value: number;
  currencyCode?: string | null;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <EnterpriseCard>
      <EnterpriseCardHeader className="pb-1">
        <EnterpriseCardDescription>{label}</EnterpriseCardDescription>
      </EnterpriseCardHeader>
      <EnterpriseCardContent>
        <EnterpriseCardTitle
          className={cn(
            "text-lg font-semibold tabular-nums",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning-foreground",
          )}
        >
          {formatMoney(value, currencyCode)}
        </EnterpriseCardTitle>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
