"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/business/status-badge";
import { EMPTY_REPORT_FILTERS } from "@/components/accounting/report-filter-bar";
import { financeReportHref } from "@/app/(shell)/reports/finance/report-url";
import { fiscalYearsService, type FiscalYearRow } from "@/services/fiscal-years-service";
import {
  yearClosingService,
  type DerivedOpeningBalances,
  type YearClosingStatus,
} from "@/services/year-closing-service";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { formatAmount } from "@/lib/money";
import { formatDate, fromISODate } from "@/lib/date";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";

const MIN_REASON = 5;

/**
 * TASK-055 Part 5 — distinct from Fiscal Years' plain Close: posts the
 * closing entry (P&L → Retained Earnings) through the Posting Engine,
 * once per year (idempotent). The next year's opening balances are derived
 * from the ledger — shown here and in the Trial Balance's opening column —
 * never posted. A closing can be reversed (auditable, with a reason) to
 * reopen the year, then closed again.
 */
export default function YearClosingPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("accounting.fiscal-years.manage");

  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([]);
  const [fiscalYearId, setFiscalYearId] = useState("");
  const fieldId = useId();
  const [status, setStatus] = useState<YearClosingStatus | null>(null);
  const [opening, setOpening] = useState<DerivedOpeningBalances | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isReversing, setIsReversing] = useState(false);

  useEffect(() => {
    fiscalYearsService
      .list()
      .then(setFiscalYears)
      .catch(() => setFiscalYears([]));
  }, []);

  const load = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const next = await yearClosingService.status(id);
      setStatus(next);
      setOpening(
        next.nextFiscalYear
          ? await yearClosingService.derivedOpening(next.nextFiscalYear.id).catch(() => null)
          : null,
      );
    } catch (error) {
      setStatus(null);
      setOpening(null);
      reportApiError(error, "errors.generic");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fiscalYearId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(null);
      setOpening(null);
      return;
    }
    void load(fiscalYearId);
  }, [fiscalYearId, load]);

  const handleRun = async () => {
    if (!fiscalYearId) return;
    setIsRunning(true);
    try {
      const outcome = await yearClosingService.execute({ fiscalYearId });
      toast.success(
        outcome.alreadyClosed
          ? t("accounting.yearClosing.toasts.alreadyClosed", {
              entryNumber: outcome.closingEntry.entryNumber,
            })
          : t("accounting.yearClosing.toasts.completed"),
      );
      setConfirmRun(false);
      void load(fiscalYearId);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsRunning(false);
    }
  };

  const handleReverse = async () => {
    if (!fiscalYearId || reason.trim().length < MIN_REASON) return;
    setIsReversing(true);
    try {
      const outcome = await yearClosingService.reverse(fiscalYearId, reason.trim());
      toast.success(
        t("accounting.yearClosing.toasts.reversed", {
          entryNumber: outcome.reversal.entryNumber,
        }),
      );
      setReverseOpen(false);
      setReason("");
      void load(fiscalYearId);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsReversing(false);
    }
  };

  const active = status?.activeClosing ?? null;
  const next = status?.nextFiscalYear ?? null;
  const trialBalanceHref = next
    ? financeReportHref("trialBalance", {
        ...EMPTY_REPORT_FILTERS,
        dateRange: {
          from: fromISODate(next.startDate.slice(0, 10)),
          to: fromISODate(next.endDate.slice(0, 10)),
        },
      })
    : null;

  return (
    <PageWorkspace
      title={t("nav.financeYearClosing")}
      description={t("accounting.yearClosing.description")}
    >
      <EnterpriseCard>
        <EnterpriseCardContent className="flex flex-col gap-5 pt-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${fieldId}-fy`} className="text-caption text-muted-foreground">
                {t("accounting.yearClosing.fields.fiscalYear")}
              </label>
              <Select value={fiscalYearId || undefined} onValueChange={setFiscalYearId}>
                <SelectTrigger id={`${fieldId}-fy`} className="w-full">
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
            </div>
            <p className="self-end text-caption text-muted-foreground">
              {t("accounting.yearClosing.derivedOpeningExplained")}
            </p>
          </div>

          {isLoading && <p className="text-caption text-muted-foreground">{t("common.loading")}</p>}

          {!isLoading && status && active && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  label={t(JOURNAL_ENTRY_STATUS_LABEL_KEY[active.status])}
                  tone={JOURNAL_ENTRY_STATUS_TONE[active.status]}
                />
                <span className="text-caption text-muted-foreground">
                  {t("accounting.yearClosing.alreadyClosed", { entryNumber: active.entryNumber })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/finance/journal-entries/${active.id}`} className="w-fit">
                  <EnterpriseButton type="button" variant="outline" size="sm">
                    {t("accounting.yearClosing.viewClosingEntry")}
                  </EnterpriseButton>
                </Link>
                {canManage && (
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!status.canReverse}
                    onClick={() => setReverseOpen(true)}
                  >
                    {t("accounting.yearClosing.reverse")}
                  </EnterpriseButton>
                )}
              </div>
              {!status.canReverse && (
                <p className="text-caption text-muted-foreground">
                  {t("accounting.yearClosing.reverseBlocked")}
                </p>
              )}
            </div>
          )}

          {!isLoading && status && !active && (
            <div className="flex flex-col gap-3">
              {status.blockers.length > 0 && (
                <ul className="flex flex-col gap-1 text-caption text-destructive">
                  {status.blockers.map((blocker) => (
                    <li key={blocker.code}>
                      {blocker.code === "FISCAL_YEAR_NOT_CLOSED"
                        ? t("accounting.yearClosing.mustBeClosedFirst")
                        : blocker.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end">
                <EnterpriseButton
                  type="button"
                  disabled={!canManage || !status.canClose || isRunning}
                  onClick={() => setConfirmRun(true)}
                >
                  {t("accounting.yearClosing.run")}
                </EnterpriseButton>
              </div>
            </div>
          )}

          {!isLoading && status && status.history.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-caption font-medium text-muted-foreground">
                {t("accounting.yearClosing.history")}
              </p>
              <ul className="flex flex-col gap-1 text-caption">
                {status.history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/finance/journal-entries/${entry.id}`}
                      className="text-primary hover:underline"
                    >
                      <code dir="ltr">{entry.entryNumber}</code>
                    </Link>
                    <span className="text-muted-foreground">
                      {entry.reversalOfEntryId
                        ? t("accounting.yearClosing.historyReversal")
                        : t(JOURNAL_ENTRY_STATUS_LABEL_KEY[entry.status])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!isLoading && next && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-4">
              <p className="text-body font-medium">
                {t("accounting.yearClosing.nextOpeningTitle", { name: next.name })}
              </p>
              <p className="text-caption text-muted-foreground">
                {active
                  ? t("accounting.yearClosing.nextOpeningAfterClosing")
                  : t("accounting.yearClosing.nextOpeningBeforeClosing")}
              </p>
              {opening && (
                <dl className="grid grid-cols-1 gap-2 text-caption sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">
                      {t("accounting.yearClosing.openingAccounts")}
                    </dt>
                    <dd className="tabular-nums">{opening.accounts.length}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("accounting.yearClosing.openingTotals")}
                    </dt>
                    <dd className="tabular-nums" dir="ltr">
                      {formatAmount(opening.totals.debit)} / {formatAmount(opening.totals.credit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("accounting.yearClosing.openingProfitAndLoss")}
                    </dt>
                    <dd className="tabular-nums" dir="ltr">
                      {formatAmount(opening.profitAndLossOpening)}
                    </dd>
                  </div>
                </dl>
              )}
              {trialBalanceHref && (
                <Link href={trialBalanceHref} className="w-fit">
                  <EnterpriseButton type="button" variant="outline" size="sm">
                    {t("accounting.yearClosing.viewOpeningBalances", {
                      date: formatDate(next.startDate),
                    })}
                  </EnterpriseButton>
                </Link>
              )}
            </div>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      <ConfirmationDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title={t("accounting.yearClosing.confirmRunTitle")}
        description={t("accounting.yearClosing.confirmRunDescription")}
        confirmLabel={t("accounting.yearClosing.run")}
        tone="success"
        isConfirming={isRunning}
        onConfirm={() => void handleRun()}
      />
      <ConfirmationDialog
        open={reverseOpen}
        onOpenChange={(open) => {
          setReverseOpen(open);
          if (!open) setReason("");
        }}
        title={t("accounting.yearClosing.confirmReverseTitle")}
        description={t("accounting.yearClosing.confirmReverseDescription")}
        extra={
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${fieldId}-reason`} className="text-caption text-muted-foreground">
              {t("accounting.yearClosing.reverseReason")}
            </label>
            <Textarea
              id={`${fieldId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
            />
          </div>
        }
        confirmLabel={t("accounting.yearClosing.reverse")}
        tone="warning"
        confirmDisabled={reason.trim().length < MIN_REASON}
        isConfirming={isReversing}
        onConfirm={() => void handleReverse()}
      />
    </PageWorkspace>
  );
}
