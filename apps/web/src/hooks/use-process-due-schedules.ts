"use client";

import { useCallback, useState } from "react";
import { accountingSchedulesService } from "@/services/accounting-schedules-service";
import { prepaidExpensesService } from "@/services/prepaid-expenses-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";

/**
 * "Process due entries" — posts every schedule row whose period has ended
 * (today in Cairo), the same code the daily cron runs, and reports what
 * happened: posted count, and rows that stayed pending (their last error is
 * on the schedule). `all` = depreciation + prepaid (`/accounting-schedules/run`,
 * fixed-assets edit permission); `prepaid` = recognitions only
 * (`/prepaid-expenses/recognize`, prepaid edit permission).
 */
export function useProcessDueSchedules(scope: "all" | "prepaid", onDone?: () => void) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      let posted: number;
      let failed: number;
      if (scope === "all") {
        const result = await accountingSchedulesService.runDue();
        posted = result.depreciation.posted + result.prepaid.posted;
        failed = result.depreciation.failed + result.prepaid.failed;
      } else {
        const result = await prepaidExpensesService.recognize();
        posted = result.postedCount;
        failed = result.failedCount;
      }
      if (failed > 0) {
        toast.warning(t("assetSchedules.toasts.processedWithFailures", { posted, failed }));
      } else if (posted === 0) {
        toast.info(t("assetSchedules.toasts.nothingDue"));
      } else {
        toast.success(t("assetSchedules.toasts.processed", { posted }));
      }
      onDone?.();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setBusy(false);
    }
  }, [scope, onDone, t]);

  return { run, busy };
}
