"use client";

import { cn } from "@/lib/utils";

export function ReportMoney({
  value,
  emphasize,
  tone,
  signed = true,
}: {
  value: number;
  emphasize?: boolean;
  tone?: "success" | "danger" | "muted";
  signed?: boolean;
}) {
  const abs = Math.abs(value) < 0.005;
  const negative = signed && value < -0.005;
  const resolvedTone = tone ?? (negative ? "danger" : undefined);
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-block w-full min-w-[6.5rem] text-end tabular-nums text-foreground",
        emphasize && "text-body font-semibold",
        resolvedTone === "success" && "text-success",
        resolvedTone === "danger" && "text-destructive",
        resolvedTone === "muted" && "text-muted-foreground",
        abs && "text-muted-foreground",
      )}
    >
      {abs
        ? "—"
        : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
