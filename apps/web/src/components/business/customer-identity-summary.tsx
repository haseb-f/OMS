"use client";

import { UserCheck } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";

/**
 * The concise identity of a recognized / selected customer: who they are and
 * where they are. Shown instead of re-asking name and phone once a customer is
 * chosen — the form then asks only for what is missing or an intentional,
 * order-specific change.
 */
export function CustomerIdentitySummary({
  name,
  phone,
  location,
  changeLabel,
  onChange,
}: {
  name: string;
  phone?: string | null;
  /** Country / city / address on one line (already formatted by the caller). */
  location?: string | null;
  changeLabel: string;
  onChange: () => void;
}) {
  return (
    <div
      data-testid="customer-identity-summary"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-sm border border-border bg-surface-sunken px-3 py-2"
    >
      <span className="flex min-w-0 items-start gap-2">
        <UserCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        <span className="flex min-w-0 flex-col">
          <bdi className="truncate font-medium text-foreground">{name}</bdi>
          {phone ? (
            <bdi dir="ltr" className="num text-caption text-muted-foreground">
              {phone}
            </bdi>
          ) : null}
          {location ? <span className="text-caption text-muted-foreground">{location}</span> : null}
        </span>
      </span>
      <EnterpriseButton type="button" variant="ghost" size="sm" onClick={onChange}>
        {changeLabel}
      </EnterpriseButton>
    </div>
  );
}
