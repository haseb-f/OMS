"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitCompareArrows,
  ShieldAlert,
  ThumbsDown,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { StatusBadge } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  paymentReconciliationService,
  type ClaimView,
  type StatementLine,
  type Suggestion,
  type SuggestionResult,
} from "@/services/payment-reconciliation-service";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PaymentActionButton } from "@/components/payments/payment-action-button";
import { PaymentRecordBadge } from "@/components/payments/payment-term-badge";
import { PaymentMatchPanel } from "@/components/payments/match-panel/payment-match-panel";
import { BulkResultDialog } from "@/components/payments/bulk-result-dialog";
import { formatCurrencyTotals, totalsByCurrency } from "@/components/payments/payment-totals";
import { BULK_LIMITS } from "@/lib/bulk-limits";
import type { BulkItemsResult } from "@/services/payments-review-service";
import type { BulkAcceptPlan } from "@/services/payment-reconciliation-service";
import { AllocationDialog, ClaimIdentity, type AllocationLine } from "./allocation-dialog";
import { ReasonDialog } from "./reason-dialog";
import {
  STRENGTH_TONE,
  canQuickConfirm,
  newIdempotencyKey,
  reasonTone,
  visibleReasons,
} from "./reconciliation-model";

/**
 * Matching: unmatched provider transactions → ranked claim suggestions with
 * reason chips. Every confirmation goes through the allocation dialog (an
 * explicit user action); ambiguous rankings say so and drop the one-click
 * "Confirm match & post" in favour of an explicit pick.
 */
export function MatchingTab({
  methodId,
  focusLineId,
  canMatch,
  refreshKey,
  onChanged,
}: {
  methodId: string;
  focusLineId?: string | null;
  canMatch: boolean;
  refreshKey?: unknown;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [search, setSearch] = useState("");
  const [loadingLines, setLoadingLines] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(focusLineId ?? null);
  const [suggestions, setSuggestions] = useState<SuggestionResult | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [allocation, setAllocation] = useState<{
    line: AllocationLine;
    claims: ClaimView[];
  } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Suggestion | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<ClaimView | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [acceptPlan, setAcceptPlan] = useState<{
    eligible: BulkAcceptPlan[];
    checked: number;
    key: string;
  } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptResult, setAcceptResult] = useState<{
    result: BulkItemsResult<BulkAcceptPlan>;
    labels: Map<string, string>;
  } | null>(null);

  const loadLines = useCallback(async () => {
    setLoadingLines(true);
    try {
      const result = await paymentReconciliationService.listLines(methodId, {
        status: "UNMATCHED",
        search: search || undefined,
        pageSize: 100,
      });
      setLines(result.items);
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    } finally {
      setLoadingLines(false);
    }
  }, [methodId, search, t]);

  const loadClaims = useCallback(async () => {
    try {
      setClaims(await paymentReconciliationService.awaitingClaims(methodId));
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    }
  }, [methodId, t]);

  const loadSuggestions = useCallback(
    async (lineId: string) => {
      setLoadingSuggestions(true);
      try {
        setSuggestions(await paymentReconciliationService.suggestions(methodId, lineId));
      } catch (error) {
        setSuggestions(null);
        reportApiError(error, t("common.loadFailed"));
      } finally {
        setLoadingSuggestions(false);
      }
    },
    [methodId, t],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLines();
    void loadClaims();
  }, [loadLines, loadClaims, refreshKey]);

  useEffect(() => {
    if (focusLineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(focusLineId);
    }
  }, [focusLineId]);

  useEffect(() => {
    if (selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadSuggestions(selectedId);
    } else {
      setSuggestions(null);
    }
  }, [selectedId, loadSuggestions]);

  const selectedLine = lines.find((line) => line.id === selectedId) ?? null;
  const refreshAll = () => {
    void loadLines();
    void loadClaims();
    if (selectedId) void loadSuggestions(selectedId);
    onChanged();
  };

  const lineLabel = (lineId: string) => {
    const line = lines.find((row) => row.id === lineId);
    return line?.providerReference ?? line?.orderReference ?? lineId;
  };

  /** Dry run on the server: which unmatched lines have a strong, unambiguous, amount-equal top suggestion. */
  const planAcceptStrong = async () => {
    const ids = lines.slice(0, BULK_LIMITS.statementBulkAcceptMax).map((line) => line.id);
    if (ids.length === 0) return;
    setPlanning(true);
    try {
      const plan = await paymentReconciliationService.bulkAccept(methodId, {
        dryRun: true,
        items: ids.map((statementLineId) => ({ statementLineId })),
      });
      if (plan.succeeded.length === 0) {
        toast.info(t("paymentVocabulary.bulk.acceptNone"));
        return;
      }
      setAcceptPlan({ eligible: plan.succeeded, checked: ids.length, key: newIdempotencyKey() });
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    } finally {
      setPlanning(false);
    }
  };

  const commitAcceptStrong = async () => {
    if (!acceptPlan) return;
    setAccepting(true);
    try {
      const result = await paymentReconciliationService.bulkAccept(methodId, {
        idempotencyKey: acceptPlan.key.slice(0, 80),
        // The reviewed pair is sent back: a changed top suggestion is refused, never swapped.
        items: acceptPlan.eligible.map((row) => ({
          statementLineId: row.id,
          paymentId: row.paymentId,
        })),
      });
      if (result.failed.length === 0) {
        toast.success(t("paymentVocabulary.bulk.allDone", { count: result.succeeded.length }));
      } else {
        setAcceptResult({
          result,
          labels: new Map(lines.map((line) => [line.id, lineLabel(line.id)])),
        });
      }
      setAcceptPlan(null);
      refreshAll();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setAccepting(false);
    }
  };

  const openAllocation = (claimsToAllocate: ClaimView[]) => {
    if (!suggestions) return;
    setAllocation({
      line: {
        id: suggestions.line.id,
        providerReference: selectedLine?.providerReference ?? null,
        remaining: suggestions.line.remaining,
        currency: suggestions.line.currency,
      },
      claims: claimsToAllocate,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <EnterpriseCard className="relative min-w-0">
          {loadingLines ? <LoadingOverlay /> : null}
          <EnterpriseCardHeader className="flex flex-wrap items-center justify-between gap-2">
            <EnterpriseCardTitle>
              {t("paymentReconciliation.matching.unmatchedTitle")}
            </EnterpriseCardTitle>
            {canMatch && lines.length > 0 ? (
              <PaymentActionButton
                intent="acceptStrong"
                isLoading={planning}
                onClick={() => void planAcceptStrong()}
                data-testid="accept-strong-suggestions"
              />
            ) : null}
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="flex flex-col gap-2">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t("paymentReconciliation.statement.searchPlaceholder")}
            />
            {lines.length === 0 && !loadingLines ? (
              <EmptyState
                icon={CheckCircle2}
                title={t("paymentReconciliation.matching.unmatchedEmpty")}
              />
            ) : (
              <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto">
                {lines.map((line) => (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(line.id)}
                      aria-pressed={line.id === selectedId}
                      className={cn(
                        "flex w-full min-w-0 items-start justify-between gap-2 rounded-sm border px-2 py-1.5 text-start",
                        line.id === selectedId
                          ? "border-primary bg-primary-soft"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span dir="ltr" className="truncate font-medium">
                          {line.providerReference ?? line.orderReference ?? "—"}
                        </span>
                        <span className="truncate text-caption text-muted-foreground">
                          {formatDate(line.transactionDate)}
                          {line.customerName ? ` · ${line.customerName}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-body font-medium tabular-nums" dir="ltr">
                        {formatMoney(line.remaining, line.currency.code)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </EnterpriseCardContent>
        </EnterpriseCard>

        <EnterpriseCard className="relative min-w-0">
          {loadingSuggestions ? <LoadingOverlay /> : null}
          <EnterpriseCardHeader>
            <EnterpriseCardTitle>
              {t("paymentReconciliation.matching.suggestionsTitle")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="flex flex-col gap-2">
            {!suggestions ? (
              <p className="text-caption text-muted-foreground">
                {t("paymentReconciliation.matching.selectLine")}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-caption text-muted-foreground" dir="auto">
                    {t("paymentReconciliation.matching.lineRemaining", {
                      amount: formatMoney(
                        suggestions.line.remaining,
                        suggestions.line.currency.code,
                      ),
                    })}
                  </span>
                  {canMatch && !suggestions.blockedReason ? (
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openAllocation([])}
                    >
                      <GitCompareArrows />
                      {t("paymentReconciliation.matching.pickExplicitly")}
                    </EnterpriseButton>
                  ) : null}
                </div>
                {suggestions.blockedReason ? (
                  <Alert tone="warning">
                    <AlertTriangle />
                    <AlertDescription>{suggestions.blockedReason}</AlertDescription>
                  </Alert>
                ) : null}
                {suggestions.ambiguous ? (
                  <Alert tone="warning">
                    <ShieldAlert />
                    <AlertDescription>
                      {t("paymentReconciliation.matching.ambiguous")}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {!suggestions.blockedReason && suggestions.candidates.length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    {t("paymentReconciliation.matching.noSuggestions")}
                  </p>
                ) : null}
                {suggestions.candidates.map((candidate) => (
                  <div
                    key={candidate.paymentId}
                    className="flex flex-col gap-2 rounded-sm border border-border p-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ClaimIdentity claim={candidate.claim} />
                      <span className="text-body font-medium tabular-nums" dir="ltr">
                        {formatMoney(candidate.claim.remaining, candidate.claim.currency.code)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge
                        label={t(`paymentReconciliation.matching.strength.${candidate.strength}`)}
                        tone={STRENGTH_TONE[candidate.strength]}
                      />
                      {visibleReasons(candidate.reasons).map((reason) => (
                        <span key={`${reason.signal}-${reason.detail}`} title={reason.detail}>
                          <StatusBadge
                            label={t(`paymentReconciliation.signal.${reason.signal}` as MessageKey)}
                            tone={reasonTone(reason)}
                          />
                        </span>
                      ))}
                    </div>
                    {canMatch ? (
                      <div className="flex flex-wrap gap-2">
                        <PaymentActionButton
                          intent={
                            canQuickConfirm(suggestions, candidate) ? "confirmMatchPost" : "match"
                          }
                          quiet
                          onClick={() => openAllocation([candidate.claim])}
                        />
                        <PaymentActionButton
                          intent="review"
                          quiet
                          onClick={() => setPanelId(candidate.claim.id)}
                        />
                        <EnterpriseButton
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRejectTarget(candidate)}
                        >
                          <ThumbsDown />
                          {t("paymentReconciliation.matching.reject")}
                        </EnterpriseButton>
                        <PaymentActionButton
                          intent="dispute"
                          onClick={() => setDisputeTarget(candidate.claim)}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </>
            )}
          </EnterpriseCardContent>
        </EnterpriseCard>
      </div>

      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("paymentReconciliation.matching.claimsTitle")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          <CompactDetailTable<ClaimView>
            rows={claims}
            rowKey={(claim) => claim.id}
            empty={t("paymentReconciliation.matching.claimsEmpty")}
            columns={[
              {
                id: "claim",
                header: t("paymentReconciliation.fields.claim"),
                cell: (claim) => (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <ClaimIdentity claim={claim} />
                    {claim.disputeReason ? (
                      <span className="text-caption text-destructive">{claim.disputeReason}</span>
                    ) : null}
                  </div>
                ),
              },
              {
                id: "remaining",
                header: t("paymentReconciliation.fields.remaining"),
                align: "end",
                cell: (claim) => (
                  <span dir="ltr">{formatMoney(claim.remaining, claim.currency.code)}</span>
                ),
              },
              {
                id: "actions",
                header: "",
                align: "end",
                cell: (claim) => (
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <PaymentActionButton
                      intent="review"
                      size="xs"
                      quiet
                      onClick={() => setPanelId(claim.id)}
                    />
                    {canMatch && (claim.status === "PENDING" || claim.status === "MATCHED") ? (
                      <PaymentActionButton
                        intent="dispute"
                        size="xs"
                        onClick={() => setDisputeTarget(claim)}
                      />
                    ) : (
                      <PaymentRecordBadge status={claim.status} />
                    )}
                  </div>
                ),
              },
            ]}
          />
        </EnterpriseCardContent>
      </EnterpriseCard>

      {allocation ? (
        <AllocationDialog
          methodId={methodId}
          line={allocation.line}
          initialClaims={allocation.claims}
          onClose={() => setAllocation(null)}
          onDone={() => {
            setAllocation(null);
            refreshAll();
          }}
        />
      ) : null}

      <ReasonDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        title={t("paymentReconciliation.matching.rejectTitle")}
        description={t("paymentReconciliation.matching.rejectDescription")}
        confirmLabel={t("paymentReconciliation.matching.reject")}
        reasonRequired={false}
        onConfirm={async (reason) => {
          if (!rejectTarget || !selectedId) return;
          try {
            await paymentReconciliationService.dismissSuggestion(
              methodId,
              selectedId,
              rejectTarget.paymentId,
              reason || undefined,
            );
            toast.success(t("paymentReconciliation.matching.rejected"));
            void loadSuggestions(selectedId);
          } catch (error) {
            reportApiError(error, t("common.failedToSave"));
            throw error;
          }
        }}
      />

      <PaymentMatchPanel
        paymentId={panelId}
        onOpenChange={(open) => !open && setPanelId(null)}
        onChanged={refreshAll}
      />

      <ConfirmationDialog
        open={!!acceptPlan}
        onOpenChange={(open) => {
          if (!open && !accepting) setAcceptPlan(null);
        }}
        tone="success"
        size="lg"
        title={
          acceptPlan
            ? t("paymentVocabulary.bulk.acceptTitle", { count: acceptPlan.eligible.length })
            : ""
        }
        description={
          acceptPlan ? (
            <>
              {t("paymentVocabulary.bulk.selectedEligible", {
                eligible: acceptPlan.eligible.length,
                selected: acceptPlan.checked,
              })}{" "}
              {t("paymentVocabulary.effect.bulkAccept", {
                totals: formatCurrencyTotals(
                  totalsByCurrency(acceptPlan.eligible, (row) => ({
                    code: row.currencyCode,
                    amount: row.amount,
                  })),
                ),
              })}
            </>
          ) : undefined
        }
        extra={
          acceptPlan ? (
            <ul className="flex max-h-60 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border text-caption">
              {acceptPlan.eligible.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5"
                >
                  <span dir="ltr">{row.providerReference ?? row.id.slice(0, 8)}</span>
                  <span>
                    {row.paymentNumber}
                    {row.orderNumber ? ` · ${row.orderNumber}` : ""}
                  </span>
                  <span dir="ltr" className="tabular-nums">
                    {formatMoney(row.amount, row.currencyCode)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null
        }
        confirmLabel={t("paymentVocabulary.action.acceptStrong")}
        isConfirming={accepting}
        onConfirm={() => void commitAcceptStrong()}
      />

      <BulkResultDialog
        result={acceptResult?.result ?? null}
        label={(id) => acceptResult?.labels.get(id) ?? id}
        onClose={() => setAcceptResult(null)}
      />

      <ReasonDialog
        open={!!disputeTarget}
        onOpenChange={(open) => !open && setDisputeTarget(null)}
        tone="destructive"
        title={t("paymentReconciliation.matching.disputeTitle")}
        description={t("paymentReconciliation.matching.disputeDescription")}
        confirmLabel={t("paymentReconciliation.matching.dispute")}
        onConfirm={async (reason) => {
          if (!disputeTarget) return;
          try {
            await paymentReconciliationService.disputeClaim(methodId, disputeTarget.id, reason);
            toast.success(t("paymentReconciliation.matching.disputed"));
            refreshAll();
          } catch (error) {
            reportApiError(error, t("common.failedToSave"));
            throw error;
          }
        }}
      />
    </div>
  );
}
