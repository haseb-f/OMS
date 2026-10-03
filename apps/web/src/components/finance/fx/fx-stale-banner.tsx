"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocale } from "@/providers/locale-provider";
import type { FxSyncStatus } from "@/services/fx-service";
import { fxDayLabel } from "./fx-format";

/** Scraper-health warning: the newest official rate is older than `staleAlertDays`. */
export function FxStaleBanner({ status }: { status: FxSyncStatus | null }) {
  const { t } = useLocale();
  if (!status?.staleAlert) return null;
  return (
    <Alert tone="warning" className="mb-3" data-testid="fx-stale-banner">
      <AlertTitle>{t("fxSettings.staleBanner.title")}</AlertTitle>
      <AlertDescription>
        {status.newestEffectiveDate
          ? t("fxSettings.staleBanner.body", {
              date: fxDayLabel(t, status.newestEffectiveDate),
              days: status.newestAgeDays ?? 0,
            })
          : t("fxSettings.staleBanner.none")}
        {status.lastRun?.status === "FAILED" && status.lastRun.error ? (
          <span className="mt-1 block break-words">
            {t("fxSettings.staleBanner.lastFailed", { error: status.lastRun.error })}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
