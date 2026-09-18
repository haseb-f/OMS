"use client";

import { cn } from "@/lib/utils";

export function ReportMoney({
  value,
  emphasize,
  tone,
}: {
  value: number;
  emphasize?: boolean;
  tone?: "success" | "danger" | "muted";
}) {
  const abs = Math.abs(value) < 0.005;
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-block min-w-[5.5rem] text-end tabular-nums",
        emphasize && "font-semibold",
        tone === "success" && "text-success",
        tone === "danger" && "text-destructive",
        tone === "muted" && "text-muted-foreground",
        abs && !emphasize && "text-muted-foreground",
      )}
    >
      {abs
        ? "—"
        : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
