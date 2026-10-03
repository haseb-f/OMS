"use client";

import { CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/**
 * "New to you / جديد لك" - the per-employee viewed marker. Deliberately quiet
 * and unlike a status badge (no fill, primary text, small dot): it says "you
 * have not opened this lead", never "nobody has worked it". `compact` is the
 * dot-only form for table rows (the text stays for screen readers + tooltip).
 */
export function LeadNewToYouMarker({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <span
      data-new-to-you=""
      title={t("tableViews.card.newToYouHint")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-caption font-medium text-primary",
        className,
      )}
    >
      <CircleDot aria-hidden className="size-3" />
      <span className={compact ? "sr-only" : undefined}>{t("tableViews.card.newToYou")}</span>
    </span>
  );
}
