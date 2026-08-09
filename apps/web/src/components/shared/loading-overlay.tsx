"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** Absolute overlay for a loading container — parent must be `position: relative`. */
export function LoadingOverlay({ label, className }: { label?: string; className?: string }) {
  const { t } = useLocale();

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-[1px]",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <span className="text-caption text-muted-foreground">{label ?? t("common.loading")}</span>
    </div>
  );
}
