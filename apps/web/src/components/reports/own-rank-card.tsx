"use client";

import { Trophy } from "lucide-react";
import { InsightCard } from "@/components/shared/insight-card";
import { useLocale } from "@/providers/locale-provider";

/**
 * The caller's own standing (R15 requirement 6.1) in the dashboard card
 * language: "Your rank — 3 of 12" over the whole company or the whole agent.
 * Position and count only — the API never sends a colleague's name or
 * figure to an own scope. Shared by the home dashboard ranking panel and the
 * reports' "My performance" tab.
 */
export function OwnRankCard({
  position,
  of,
  population,
  className,
}: {
  /** null = no order in the period (not ranked). */
  position: number | null;
  /** Ranked employees in the population. */
  of: number;
  population: "company" | "agent";
  className?: string;
}) {
  const { t } = useLocale();
  if (position === null) {
    return (
      <InsightCard
        icon={Trophy}
        tone="neutral"
        label={t("salesVisibility.yourRank")}
        value={t("salesVisibility.notRanked")}
        phrase
        context={t("salesVisibility.notRankedHint", { of })}
        className={className}
      />
    );
  }
  return (
    <InsightCard
      icon={Trophy}
      tone="success"
      label={t("salesVisibility.yourRank")}
      // A phrase ("3 من 12"), not a bare figure: it keeps the reading direction.
      value={t("salesVisibility.rankOf", { position, of })}
      phrase
      amount={position}
      context={t(
        population === "agent" ? "salesVisibility.amongAgent" : "salesVisibility.amongCompany",
      )}
      className={className}
    />
  );
}
