"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { EnterpriseButton } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/business/status-badge";
import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { MoneyValue } from "@/components/shared/money-value";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { PaymentActionButton } from "@/components/payments/payment-action-button";
import {
  PaymentRecordBadge,
  PaymentSettlementBadge,
  StatementLineBadge,
} from "@/components/payments/payment-term-badge";
import { ReasonDialog } from "@/components/payments/reconciliation/reason-dialog";
import {
  STRENGTH_TONE,
  newIdempotencyKey,
  reasonTone,
} from "@/components/payments/reconciliation/reconciliation-model";
import type { MessageKey } from "@/i18n/translate";
import { formatDate, formatDateTime } from "@/lib/date";
import { downloadBlob } from "@/lib/download";
import { cn } from "@/lib/utils";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { attachmentsService } from "@/services/attachments-service";
import {
  paymentsReviewService,
  type PaymentReviewContext,
} from "@/services/payments-review-service";
import {
  paymentReconciliationService,
  type ClaimActiveMatch,
  type ClaimLines,
  type StatementLineView,
} from "@/services/payment-reconciliation-service";
import {
  confirmMatchState,
  confirmPostState,
  correctionState,
  discrepancies,
  disputeState,
  initialLineId,
  matchedSignals,
  refundState,
  rejectState,
  allocationAmount,
  type ActionState,
  type MatchPanelPermissions,
  type Sentence,
} from "./match-panel-model";

const REFUND_FLOW_HREF = "/sales/payments?view=refunds";

type PendingReason =
  { kind: "reject" } | { kind: "dispute" } | { kind: "correct"; match: ClaimActiveMatch };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-body break-words">{children ?? "—"}</dd>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-body font-semibold">{children}</h3>;
}

/**
 * The shared payment match panel (Round 5 spec 3B): the declaration beside
 * its statement transaction (or ranked candidates), the evidence and the
 * discrepancy, and every action with the exact accounting effect shown
 * before it commits. Opened from Payments review rows, the Matching tab and
 * the order's payment rows. All decisions still run through the existing
 * single-record endpoints.
 */
export function PaymentMatchPanel({
  paymentId,
  onOpenChange,
  onChanged,
}: {
  paymentId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canReadStatements = hasPermission("finance.payment-reconciliation.view");
  const canMatch = hasPermission("finance.payment-reconciliation.match");
  const permissions: MatchPanelPermissions = {
    canConfirm: hasPermission("sales.receipts.confirm"),
    canMatch,
    canCorrect: hasPermission("finance.payment-reconciliation.correct"),
  };

  const [context, setContext] = useState<PaymentReviewContext | null>(null);
  const [lines, setLines] = useState<ClaimLines | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingReason | null>(null);
  /** One idempotency key per (panel session, line): a double-click never allocates twice. */
  const matchKeys = useRef(new Map<string, string>());

  const load = useCallback(
    async (id: string) => {
      try {
        const next = await paymentsReviewService.context(id);
        setContext(next);
        if (next.method?.requiresReconciliation && canReadStatements) {
          const statement = await paymentReconciliationService.claimLines(next.method.id, id);
          setLines(statement);
          setSelectedLineId((current) =>
            current &&
            [...statement.activeMatches, ...statement.candidates].some(
              (row) => row.line.id === current,
            )
              ? current
              : initialLineId(statement),
          );
        } else {
          setLines(null);
          setSelectedLineId(null);
        }
      } catch (error) {
        reportApiError(error, "common.loadFailed");
      }
    },
    [canReadStatements],
  );

  useEffect(() => {
    if (!paymentId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContext(null);
    setLines(null);
    setSelectedLineId(null);
    matchKeys.current = new Map();
    void load(paymentId);
  }, [paymentId, load]);

  const refresh = async () => {
    if (paymentId) await load(paymentId);
    onChanged?.();
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const sentence = (value: Sentence) => t(value.key, value.params);
  const reconciled = !!context?.method?.requiresReconciliation;
  const allLines: { line: StatementLineView; match?: ClaimActiveMatch }[] = [
    ...(lines?.activeMatches.map((match) => ({ line: match.line, match })) ?? []),
    ...(lines?.candidates.map((candidate) => ({ line: candidate.line })) ?? []),
  ];
  const selected = allLines.find((row) => row.line.id === selectedLineId) ?? null;
  const selectedCandidate = lines?.candidates.find((row) => row.line.id === selectedLineId) ?? null;

  const primary: (ActionState & { intent: "confirmPost" | "confirmMatchPost" }) | null = !context
    ? null
    : reconciled
      ? {
          intent: "confirmMatchPost",
          ...confirmMatchState(context, selectedCandidate?.line ?? null, permissions),
        }
      : { intent: "confirmPost", ...confirmPostState(context, permissions) };
  const disputePermissions = {
    ...permissions,
    canConfirm: permissions.canConfirm || (reconciled && canMatch),
  };

  const confirmPost = () =>
    run(async () => {
      if (!context) return;
      try {
        const result = await paymentsReviewService.confirm(context.id);
        toast.success(
          t("paymentVocabulary.panel.done.confirmed", {
            receipt: result.receipt.transactionNumber,
            journal: result.receipt.journalEntry?.entryNumber ?? "—",
          }),
        );
        await refresh();
      } catch (error) {
        reportApiError(error, "common.failedToSave");
      }
    });

  const confirmMatch = () =>
    run(async () => {
      if (!context?.method || !selectedCandidate) return;
      const line = selectedCandidate.line;
      const key = matchKeys.current.get(line.id) ?? newIdempotencyKey();
      matchKeys.current.set(line.id, key);
      try {
        const result = await paymentReconciliationService.confirmMatch(context.method.id, {
          statementLineId: line.id,
          allocations: [{ paymentId: context.id, amount: allocationAmount(context, line) }],
          idempotencyKey: key,
        });
        const posted = result.postings.some((row) => row.paymentId === context.id && row.posted);
        toast.success(
          t("paymentVocabulary.panel.done.matched", {
            posted: t(
              posted
                ? "paymentVocabulary.panel.done.matchedPosted"
                : "paymentVocabulary.panel.done.matchedPartial",
            ),
          }),
        );
        await refresh();
      } catch (error) {
        reportApiError(error, "common.failedToSave");
      }
    });

  const submitReason = async (reason: string) => {
    if (!context || !pending) return;
    try {
      if (pending.kind === "reject") {
        await paymentsReviewService.reject(context.id, reason);
        toast.success(
          t("paymentVocabulary.panel.done.rejected", { payment: context.paymentNumber }),
        );
      } else if (pending.kind === "dispute") {
        if (permissions.canConfirm || !context.method) {
          await paymentsReviewService.dispute(context.id, reason);
        } else {
          await paymentReconciliationService.disputeClaim(context.method.id, context.id, reason);
        }
        toast.success(
          t("paymentVocabulary.panel.done.disputed", { payment: context.paymentNumber }),
        );
      } else if (context.method) {
        const result = await paymentReconciliationService.reverseMatch(
          context.method.id,
          pending.match.id,
          reason,
        );
        toast.success(
          result.cancelledReceipt
            ? t("paymentVocabulary.panel.done.reversed", {
                receipt: result.cancelledReceipt.transactionNumber,
              })
            : t("paymentVocabulary.panel.done.unmatched"),
        );
      }
      await refresh();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
      throw error;
    }
  };

  const reject = context ? rejectState(context, permissions) : null;
  const dispute = context ? disputeState(context, disputePermissions) : null;
  const refund = context ? refundState(context) : null;
  const pendingCorrection =
    context && pending?.kind === "correct" && lines
      ? correctionState(context, pending.match, lines, permissions)
      : null;

  const openAttachment = async (attachment: PaymentReviewContext["attachments"][number]) => {
    if (!attachment.attachmentId) {
      window.open(attachment.fileUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const blob = await attachmentsService.download(attachment.attachmentId);
      downloadBlob(blob, attachment.fileName ?? "attachment");
    } catch (error) {
      reportApiError(error, "common.loadFailed");
    }
  };

  return (
    <>
      <Sheet open={!!paymentId} onOpenChange={onOpenChange}>
        <SheetContent size="xl" className="overflow-y-auto" data-testid="payment-match-panel">
          <SheetHeader className="pe-12">
            <SheetTitle>
              {context
                ? t("paymentVocabulary.panel.title", { payment: context.paymentNumber })
                : t("paymentVocabulary.panel.loading")}
            </SheetTitle>
            {context ? (
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PaymentRecordBadge status={context.status} />
                  <PaymentSettlementBadge status={context.settlementStatus} />
                  {context.method ? <span>{context.method.name}</span> : null}
                </div>
              </SheetDescription>
            ) : null}
          </SheetHeader>

          {!context ? (
            <div className="flex flex-col gap-2 px-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Declaration */}
                <section className="flex min-w-0 flex-col gap-2">
                  <SectionTitle>{t("paymentVocabulary.panel.declaration")}</SectionTitle>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <Field label={t("paymentVocabulary.panel.fields.order")}>
                      {context.storeOrder ? (
                        <RelatedRecordLink
                          kind="STORE_ORDER"
                          id={context.storeOrder.id}
                          number={context.storeOrder.internalOrderId}
                          variant="inline"
                        />
                      ) : null}
                    </Field>
                    <Field label={t("paymentVocabulary.panel.fields.customer")}>
                      {context.customer ? (
                        context.customer.kind === "CUSTOMER" ? (
                          <RelatedRecordLink
                            kind="CUSTOMER"
                            id={context.customer.id}
                            number={context.customer.name}
                            variant="inline"
                          />
                        ) : (
                          context.customer.name
                        )
                      ) : (
                        context.senderName
                      )}
                    </Field>
                    <Field label={t("paymentVocabulary.panel.fields.amount")}>
                      <MoneyValue value={context.amount} currency={context.currency} />
                    </Field>
                    <Field label={t("paymentVocabulary.panel.fields.date")}>
                      {formatDate(context.paymentDate)}
                    </Field>
                    <Field label={t("paymentVocabulary.panel.fields.method")}>
                      {context.method?.name ?? context.paymentSource?.name}
                    </Field>
                    <Field label={t("paymentVocabulary.panel.fields.reference")}>
                      {context.referenceNumber ? (
                        <span dir="ltr">{context.referenceNumber}</span>
                      ) : null}
                    </Field>
                    <Field label={t("paymentVocabulary.panel.fields.debitAccount")}>
                      {context.debitAccount
                        ? `${context.debitAccount.code} — ${context.debitAccount.name}`
                        : t("paymentVocabulary.reason.noDebitAccount")}
                    </Field>
                    {context.receipt ? (
                      <Field label={t("paymentVocabulary.panel.fields.receipt")}>
                        <span className="flex flex-wrap gap-1">
                          <RelatedRecordLink
                            kind="CUSTOMER_RECEIPT"
                            id={context.receipt.id}
                            number={context.receipt.transactionNumber}
                            status={context.receipt.status}
                          />
                          {context.journalEntry ? (
                            <RelatedRecordLink
                              kind="JOURNAL_ENTRY"
                              id={context.journalEntry.id}
                              number={context.journalEntry.entryNumber}
                            />
                          ) : null}
                        </span>
                      </Field>
                    ) : null}
                  </dl>
                  {context.disputeReason || context.rejectionReason ? (
                    <p className="text-caption text-muted-foreground">
                      {t("paymentVocabulary.panel.reasonLabel")}:{" "}
                      {context.disputeReason ?? context.rejectionReason}
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-muted-foreground">
                      {t("paymentVocabulary.panel.attachments")}
                    </span>
                    {context.attachments.length === 0 ? (
                      <span className="text-caption text-muted-foreground">
                        {t("paymentVocabulary.panel.noAttachments")}
                      </span>
                    ) : (
                      <ul className="flex flex-wrap gap-1">
                        {context.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            <EnterpriseButton
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => void openAttachment(attachment)}
                            >
                              <Paperclip aria-hidden />
                              <span className="max-w-40 truncate">
                                {attachment.fileName ?? attachment.attachmentType}
                              </span>
                            </EnterpriseButton>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                {/* Statement side */}
                <section className="flex min-w-0 flex-col gap-2">
                  <SectionTitle>
                    {lines && lines.activeMatches.length > 0
                      ? t("paymentVocabulary.panel.matchedTransactions")
                      : reconciled
                        ? t("paymentVocabulary.panel.suggestions")
                        : t("paymentVocabulary.panel.statement")}
                  </SectionTitle>
                  {!reconciled ? (
                    <p className="text-caption text-muted-foreground">
                      {t("paymentVocabulary.panel.notReconciled")}
                    </p>
                  ) : !canReadStatements ? (
                    <p className="text-caption text-muted-foreground">
                      {t("paymentVocabulary.panel.restricted")}
                    </p>
                  ) : !lines ? (
                    <Skeleton className="h-24 w-full" />
                  ) : (
                    <>
                      {lines.ambiguous && lines.activeMatches.length === 0 ? (
                        <Alert tone="warning">
                          <AlertDescription>
                            {t("paymentVocabulary.panel.ambiguous")}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      {allLines.length === 0 ? (
                        <p className="text-caption text-muted-foreground">
                          {t("paymentVocabulary.panel.noSuggestions")}
                        </p>
                      ) : (
                        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
                          {allLines.map(({ line, match }) => {
                            const candidate = lines.candidates.find(
                              (row) => row.line.id === line.id,
                            );
                            const isSelected = line.id === selectedLineId;
                            return (
                              <li key={line.id}>
                                <button
                                  type="button"
                                  aria-pressed={isSelected}
                                  onClick={() => setSelectedLineId(line.id)}
                                  className={cn(
                                    "flex w-full min-w-0 flex-col gap-1 rounded-sm border px-2 py-1.5 text-start",
                                    isSelected
                                      ? "border-primary bg-primary-soft"
                                      : "border-border hover:bg-muted/60",
                                  )}
                                >
                                  <span className="flex w-full min-w-0 items-center justify-between gap-2">
                                    <span dir="ltr" className="truncate font-medium">
                                      {line.providerReference ?? line.orderReference ?? "—"}
                                    </span>
                                    <MoneyValue
                                      value={match ? match.amount : line.remaining}
                                      currency={line.currency}
                                      className="shrink-0 font-medium"
                                    />
                                  </span>
                                  <span className="flex flex-wrap items-center gap-1 text-caption text-muted-foreground">
                                    {formatDate(line.transactionDate)}
                                    {line.customerName ? ` · ${line.customerName}` : ""}
                                    {match ? (
                                      <StatementLineBadge status={line.status} />
                                    ) : candidate ? (
                                      <StatusBadge
                                        label={t(
                                          `paymentReconciliation.matching.strength.${candidate.strength}`,
                                        )}
                                        tone={STRENGTH_TONE[candidate.strength]}
                                      />
                                    ) : null}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              </div>

              {selected ? (
                <SelectedLineDetails
                  context={context}
                  line={selected.line}
                  reasons={selected.match?.reasons ?? selectedCandidate?.reasons ?? []}
                />
              ) : null}

              {selected?.match && lines ? (
                <CorrectionRow
                  state={correctionState(context, selected.match, lines, permissions)}
                  onRequest={() =>
                    selected.match
                      ? setPending({ kind: "correct", match: selected.match })
                      : undefined
                  }
                  busy={busy}
                />
              ) : null}

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <DisclosureTrigger>{t("paymentVocabulary.panel.technical")}</DisclosureTrigger>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-caption sm:grid-cols-2">
                    <Field label={t("paymentVocabulary.panel.fields.paymentId")}>
                      <span dir="ltr" className="font-mono">
                        {context.id}
                      </span>
                    </Field>
                    {selected ? (
                      <>
                        <Field label={t("paymentVocabulary.panel.fields.lineId")}>
                          <span dir="ltr" className="font-mono">
                            {selected.line.id}
                          </span>
                        </Field>
                        <Field label={t("paymentVocabulary.panel.fields.importId")}>
                          <span dir="ltr" className="font-mono">
                            {selected.line.technical.importId ?? "—"}
                          </span>
                        </Field>
                        <Field label={t("paymentVocabulary.panel.fields.dedupeKey")}>
                          <span dir="ltr" className="font-mono break-all">
                            {selected.line.technical.dedupeKey}
                          </span>
                        </Field>
                        <Field label={t("paymentVocabulary.panel.fields.rowHash")}>
                          <span dir="ltr" className="font-mono break-all">
                            {selected.line.technical.rowHash ?? "—"}
                          </span>
                        </Field>
                        <Field label={t("paymentVocabulary.panel.fields.source")}>
                          {[
                            t(`paymentReconciliation.source.${selected.line.technical.sourceType}`),
                            selected.line.technical.fileName ?? selected.line.technical.sheetName,
                            selected.line.technical.rowNumber
                              ? `#${selected.line.technical.rowNumber}`
                              : null,
                            formatDateTime(selected.line.technical.importedAt),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Field>
                        {selected.line.technical.rawRow ? (
                          <div className="sm:col-span-2">
                            <Field label={t("paymentVocabulary.panel.fields.row")}>
                              <span className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                                {Object.entries(selected.line.technical.rawRow).map(
                                  ([key, value]) => (
                                    <span key={key} className="min-w-0 truncate" dir="auto">
                                      <span className="text-muted-foreground">{key}:</span>{" "}
                                      {value || "—"}
                                    </span>
                                  ),
                                )}
                              </span>
                            </Field>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </dl>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {context && primary ? (
            <SheetFooter className="border-t border-border bg-(--surface-sunken)">
              <div className="flex flex-col gap-0.5">
                <span className="text-caption font-medium text-muted-foreground">
                  {t("paymentVocabulary.effect.title")}
                </span>
                <p className="text-body" data-testid="payment-effect-sentence">
                  {primary.disabledReason ? t(primary.disabledReason) : sentence(primary.effect)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {refund && context.status === "VERIFIED" ? (
                  <PaymentActionButton
                    intent="refundCustomer"
                    href={REFUND_FLOW_HREF}
                    title={sentence(refund.effect)}
                  />
                ) : null}
                {dispute && !dispute.disabledReason ? (
                  <PaymentActionButton
                    intent="dispute"
                    disabled={busy}
                    onClick={() => setPending({ kind: "dispute" })}
                  />
                ) : null}
                {reject && context.status !== "VERIFIED" ? (
                  <PaymentActionButton
                    intent="rejectDeclaration"
                    disabled={busy}
                    disabledReason={reject.disabledReason ? t(reject.disabledReason) : null}
                    onClick={() => setPending({ kind: "reject" })}
                  />
                ) : null}
                {context.status !== "VERIFIED" ? (
                  <PaymentActionButton
                    intent={primary.intent}
                    isLoading={busy}
                    disabledReason={primary.disabledReason ? t(primary.disabledReason) : null}
                    onClick={() =>
                      void (primary.intent === "confirmPost" ? confirmPost() : confirmMatch())
                    }
                    data-testid="payment-panel-primary"
                  />
                ) : null}
              </div>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      <ReasonDialog
        open={!!pending && !!context}
        onOpenChange={(open) => !open && setPending(null)}
        tone={pending?.kind === "dispute" ? "warning" : "destructive"}
        title={
          pending?.kind === "reject"
            ? t("paymentVocabulary.action.rejectDeclaration")
            : pending?.kind === "dispute"
              ? t("paymentVocabulary.action.dispute")
              : pendingCorrection
                ? pendingCorrection.intent === "reversePosting"
                  ? `${t("paymentVocabulary.action.reversePosting")}${pendingCorrection.journal ? ` · ${pendingCorrection.journal}` : ""}`
                  : t("paymentVocabulary.action.unmatch")
                : ""
        }
        description={
          pending?.kind === "reject" && reject
            ? sentence(reject.effect)
            : pending?.kind === "dispute" && dispute
              ? sentence(dispute.effect)
              : pendingCorrection
                ? sentence(pendingCorrection.effect)
                : undefined
        }
        confirmLabel={
          pending?.kind === "reject"
            ? t("paymentVocabulary.action.rejectDeclaration")
            : pending?.kind === "dispute"
              ? t("paymentVocabulary.action.dispute")
              : pendingCorrection?.intent === "reversePosting"
                ? t("paymentVocabulary.action.reversePosting")
                : t("paymentVocabulary.action.unmatch")
        }
        onConfirm={submitReason}
      />
    </>
  );
}

/** Evidence (matched signals) and the discrepancy line for the selected statement transaction. */
function SelectedLineDetails({
  context,
  line,
  reasons,
}: {
  context: PaymentReviewContext;
  line: StatementLineView;
  reasons: { signal: string; detail: string }[];
}) {
  const { t } = useLocale();
  const issues = discrepancies(context, line);
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <Field label={t("paymentVocabulary.panel.fields.transactionDate")}>
          {formatDate(line.transactionDate)}
        </Field>
        <Field label={t("paymentReconciliation.fields.amount")}>
          <MoneyValue value={line.amount} currency={line.currency} />
        </Field>
        <Field label={t("paymentVocabulary.panel.fields.unallocated")}>
          <MoneyValue value={line.remaining} currency={line.currency} />
        </Field>
        <Field label={t("paymentVocabulary.panel.fields.payer")}>
          {[line.customerName, line.customerPhone].filter(Boolean).join(" · ") || null}
        </Field>
      </dl>
      <div className="flex flex-col gap-1">
        <span className="text-caption text-muted-foreground">
          {t("paymentVocabulary.panel.evidence")}
        </span>
        <div className="flex flex-wrap gap-1">
          {matchedSignals(reasons).map((reason) => (
            <span key={`${reason.signal}-${reason.detail}`} title={reason.detail}>
              <StatusBadge
                label={t(`paymentReconciliation.signal.${reason.signal}` as MessageKey)}
                tone={reasonTone(reason)}
              />
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-caption text-muted-foreground">
          {t("paymentVocabulary.panel.discrepancy")}
        </span>
        {issues.length === 0 ? (
          <span className="text-caption text-muted-foreground">
            {t("paymentVocabulary.panel.noDiscrepancy")}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {issues.map((issue) => (
              <StatusBadge key={issue.kind} label={t(issue.key, issue.params)} tone={issue.tone} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Unmatch vs Reverse posting for the selected active match — labelled by what the server will actually do. */
function CorrectionRow({
  state,
  onRequest,
  busy,
}: {
  state: ReturnType<typeof correctionState>;
  onRequest: () => void;
  busy: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="min-w-0 flex-1 text-caption text-muted-foreground">
        {t(state.effect.key, state.effect.params)}
      </p>
      <PaymentActionButton
        intent={state.intent}
        label={
          state.intent === "reversePosting" && state.journal
            ? `${t("paymentVocabulary.action.reversePosting")} · ${state.journal}`
            : undefined
        }
        disabled={busy}
        disabledReason={state.disabledReason ? t(state.disabledReason) : null}
        onClick={onRequest}
      />
    </div>
  );
}
