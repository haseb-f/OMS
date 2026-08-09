import type { ReactNode } from "react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";

export interface SummaryRow {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}

/** A titled card of label/value rows with an optional emphasized total — order/invoice summaries, payment breakdowns, etc. */
export function SummaryCard({
  title,
  rows,
  className,
}: {
  title: string;
  rows: SummaryRow[];
  className?: string;
}) {
  return (
    <EnterpriseCard className={className}>
      <EnterpriseCardHeader>
        <EnterpriseCardTitle>{title}</EnterpriseCardTitle>
      </EnterpriseCardHeader>
      <EnterpriseCardContent className="flex flex-col gap-2.5">
        {rows.map((row, index) => (
          <div
            key={index}
            className={
              row.emphasis
                ? "flex items-center justify-between border-t border-border pt-2.5 text-body font-semibold"
                : "flex items-center justify-between text-body text-muted-foreground"
            }
          >
            <span>{row.label}</span>
            <span className={row.emphasis ? "text-foreground" : undefined}>{row.value}</span>
          </div>
        ))}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
