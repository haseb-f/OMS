"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/business/status-badge";
import { fiscalYearsService, type FiscalYearRow } from "@/services/fiscal-years-service";
import { yearClosingService, type CloseYearResult } from "@/services/year-closing-service";
import { journalEntriesService, type JournalEntryRow } from "@/services/journal-entries-service";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/** TASK-055 Part 5 — distinct from Fiscal Years' plain Close (Finance > Fiscal Years): runs the P&L-transfer-to-Retained-Earnings ceremony via the existing Journal/Posting Engine, requires the year to already be Closed. */
export default function YearClosingPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("accounting.fiscal-years.manage");

  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([]);
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [nextFiscalYearId, setNextFiscalYearId] = useState("");
  const [existingClosing, setExistingClosing] = useState<JournalEntryRow | null | undefined>(
    undefined,
  );
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CloseYearResult | null>(null);

  useEffect(() => {
    fiscalYearsService
      .list()
      .then(setFiscalYears)
      .catch(() => setFiscalYears([]));
  }, []);

  const selectedFiscalYear = fiscalYears.find((fy) => fy.id === fiscalYearId) ?? null;
  const otherFiscalYears = fiscalYears.filter((fy) => fy.id !== fiscalYearId);

  const checkExisting = useCallback(async (id: string) => {
    setIsLoadingExisting(true);
    try {
      const items = await journalEntriesService.list({
        sourceType: "YEAR_CLOSING",
        sourceId: id,
        pageSize: 1,
      });
      setExistingClosing(items.items[0] ?? null);
    } catch {
      setExistingClosing(null);
    } finally {
      setIsLoadingExisting(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    if (!fiscalYearId) {
      setExistingClosing(undefined);
      return;
    }
    void checkExisting(fiscalYearId);
  }, [fiscalYearId, checkExisting]);

  const handleRun = async () => {
    if (!fiscalYearId) return;
    setIsRunning(true);
    try {
      const outcome = await yearClosingService.execute({
        fiscalYearId,
        nextFiscalYearId: nextFiscalYearId || undefined,
      });
      setResult(outcome);
      toast.success(t("accounting.yearClosing.toasts.completed"));
      void checkExisting(fiscalYearId);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsRunning(false);
    }
  };

  const canRun = canManage && selectedFiscalYear?.status === "CLOSED" && !existingClosing;

  return (
    <PageWorkspace
      title={t("nav.financeYearClosing")}
      description={t("accounting.yearClosing.description")}
    >
      <EnterpriseCard>
        <EnterpriseCardContent className="flex flex-col gap-5 pt-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-caption text-muted-foreground">
                {t("accounting.yearClosing.fields.fiscalYear")}
              </label>
              <Select value={fiscalYearId || undefined} onValueChange={setFiscalYearId}>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={t("accounting.openingBalances.fields.selectFiscalYear")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>
                      {fy.name} — {t(`accounting.fiscalYears.status.${fy.status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedFiscalYear && selectedFiscalYear.status !== "CLOSED" && (
                <p className="text-xs text-destructive">
                  {t("accounting.yearClosing.mustBeClosedFirst")}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-caption text-muted-foreground">
                {t("accounting.yearClosing.fields.nextFiscalYear")}
              </label>
              <Select
                value={nextFiscalYearId || "__none__"}
                onValueChange={(value) => setNextFiscalYearId(value === "__none__" ? "" : value)}
                disabled={!fiscalYearId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("accounting.yearClosing.fields.noRollForward")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t("accounting.yearClosing.fields.noRollForward")}
                  </SelectItem>
                  {otherFiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>
                      {fy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoadingExisting ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : existingClosing ? (
            <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={t(JOURNAL_ENTRY_STATUS_LABEL_KEY[existingClosing.status])}
                  tone={JOURNAL_ENTRY_STATUS_TONE[existingClosing.status]}
                />
                <span className="text-caption text-muted-foreground">
                  {t("accounting.yearClosing.alreadyClosed", {
                    entryNumber: existingClosing.entryNumber,
                  })}
                </span>
              </div>
              <Link href={`/finance/journal-entries/${existingClosing.id}`} className="w-fit">
                <EnterpriseButton type="button" variant="outline" size="sm">
                  {t("accounting.yearClosing.viewClosingEntry")}
                </EnterpriseButton>
              </Link>
            </div>
          ) : (
            fiscalYearId && (
              <div className="flex justify-end">
                <EnterpriseButton type="button" disabled={!canRun || isRunning} onClick={handleRun}>
                  {t("accounting.yearClosing.run")}
                </EnterpriseButton>
              </div>
            )
          )}

          {result && (
            <div className="flex flex-col gap-2 rounded-md border border-success/30 bg-success/5 p-4">
              <p className="text-caption font-medium text-success">
                {t("accounting.yearClosing.toasts.completed")}
              </p>
              <Link
                href={`/finance/journal-entries/${result.closingEntry.id}`}
                className="w-fit text-caption text-primary hover:underline"
              >
                {t("accounting.yearClosing.viewClosingEntry")}:{" "}
                <code dir="ltr">{result.closingEntry.entryNumber}</code>
              </Link>
              {result.openingEntry && (
                <Link
                  href={`/finance/journal-entries/${result.openingEntry.id}`}
                  className="w-fit text-caption text-primary hover:underline"
                >
                  {t("accounting.openingBalances.viewEntry")}:{" "}
                  <code dir="ltr">{result.openingEntry.entryNumber}</code>
                </Link>
              )}
            </div>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>
    </PageWorkspace>
  );
}
