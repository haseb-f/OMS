"use client";

import { EyeOff } from "lucide-react";
import { EnterpriseBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/**
 * «لم يُفتح» / "Unopened" — the lead's assigned employee has not opened it yet
 * (`isUnopenedByAssignee`, R20: the same for the employee, manager and admin;
 * cleared only by the assignee opening the detail screen, never by the row or
 * card appearing in a list). R17: a clearly visible semantic info
 * badge — the shared `EnterpriseBadge` info tone (AA token pair, light and
 * dark) with an icon AND the word, so it never relies on colour alone. The
 * same badge sits in the table row (whose start edge also carries the accent,
 * theme/recipes.css "Unopened lead") and in the grid card header. An opened
 * lead shows nothing: absence is the opened state.
 */
export function LeadUnopenedMarker({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <EnterpriseBadge
      variant="info"
      data-new-to-you=""
      title={t("tableViews.card.newToYouHint")}
      className={cn("font-semibold", className)}
    >
      <EyeOff aria-hidden />
      {t("tableViews.card.newToYou")}
    </EnterpriseBadge>
  );
}
