"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/business/status-badge";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import {
  paymentSettlementsService,
  type SettlementDetail,
} from "@/services/payment-settlements-service";
import { RatesSummary, RecordLink, SettlementJournalTable } from "./settlement-parts";

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  );
}

/** Settlement detail drawer: summary, settled claims (→ order, receipt, JE), JE lines and conversion basis. */
export function SettlementDetailSheet({
  settlementId,
  onOpenChange,
  canCorrect,
  onReversed,
}: {
  settlementId: string | null;
  onOpenChange: (open: boolean) => void;
  canCorrect: boolean;
  onReversed: () => void;
}) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);

  useEffect(() => {
    if (!settlementId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    paymentSettlementsService
      .get(settlementId)
      .then(setDetail)
      .catch((error: unknown) => {
        toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
      });
  }, [settlementId, t]);

  const basis = detail?.conversionBasis ?? null;
  const functionalCode = basis?.functionalCurrency.code ?? "";

  return (
    <>
      <Sheet open={!!settlementId} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {detail
                ? t("paymentSettlement.detail.title", { number: detail.settlementNumber })
                : t("common.loading")}
            </SheetTitle>
            {detail ? (
              <SheetDescription>
                {detail.paymentMethod.name} · {formatDate(detail.settlementDate)}
              </SheetDescription>
            ) : null}
          </SheetHeader>

          {!detail ? (
            <div className="flex flex-col gap-2 px-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-4 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusBadge
                  label={t(`paymentSettlement.docStatus.${detail.status}`)}
                  tone={detail.status === "POSTED" ? "success" : "warning"}
                />
                {canCorrect && detail.status === "POSTED" ? (
                  <EnterpriseButton
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setReverseOpen(true)}
                  >
                    <Undo2 />
                    {t("paymentSettlement.reverse.action")}
                  </EnterpriseButton>
                ) : null}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <DetailRow label={t("paymentSettlement.fields.gross")}>
                  <MoneyValue value={detail.grossAmount} currency={detail.currency} />
                </DetailRow>
                <DetailRow label={t("paymentSettlement.fields.received")}>
                  <MoneyValue value={detail.receivedAmount} currency={detail.receivedCurrency} />
                </DetailRow>
                <DetailRow label={t("paymentSettlement.fields.fee")}>
                  <MoneyValue value={detail.feeAmount} currency={detail.currency} />
                </DetailRow>
                <DetailRow label={t("paymentSettlement.fields.fxDifference")}>
                  <MoneyValue value={detail.fxDifference} currency={functionalCode} />
                </DetailRow>
                <DetailRow label={t("paymentSettlement.fields.receivingAccount")}>
                  {detail.receivingAccount.name}
                </DetailRow>
                <DetailRow label={t("paymentSettlement.fields.providerReference")}>
                  {detail.providerReference ? (
                    <SemanticValue kind="id">{detail.providerReference}</SemanticValue>
                  ) : (
                    "—"
                  )}
                </DetailRow>
              </dl>

              <section className="flex flex-col gap-1.5">
                <h3 className="text-body font-semibold">{t("paymentSettlement.detail.lines")}</h3>
                <CompactDetailTable
                  rows={detail.lines}
                  rowKey={(line) => line.id}
                  columns={[
                    {
                      id: "claim",
                      header: t("paymentSettlement.fields.claim"),
                      cell: (line) => (
                        <StackedCell
                          primary={
                            <SemanticValue kind="id">{line.payment.paymentNumber}</SemanticValue>
                          }
                          secondary={
                            <RecordLink
                              kind="STORE_ORDER"
                              id={line.storeOrder?.id}
                              label={line.storeOrder?.internalOrderId}
                            />
                          }
                        />
                      ),
                    },
                    {
                      id: "receipt",
                      header: t("paymentSettlement.fields.receipt"),
                      cell: (line) => (
                        <StackedCell
                          primary={
                            <RecordLink
                              kind="CUSTOMER_RECEIPT"
                              id={line.receipt?.id}
                              label={line.receipt?.transactionNumber}
                            />
                          }
                          secondary={
                            <RecordLink
                              kind="JOURNAL_ENTRY"
                              id={line.receipt?.journalEntryId}
                              label={line.receipt?.journalEntryNumber}
                            />
                          }
                        />
                      ),
                    },
                    {
                      id: "amount",
                      header: t("paymentSettlement.fields.settleAmount"),
                      align: "end",
                      cell: (line) => <MoneyValue value={line.amount} currency={detail.currency} />,
                    },
                    {
                      id: "carrying",
                      header: t("paymentSettlement.fields.carrying"),
                      align: "end",
                      cell: (line) => (
                        <MoneyValue
                          value={line.carryingAmountFunctional}
                          currency={functionalCode}
                        />
                      ),
                    },
                  ]}
                />
              </section>

              {detail.journalEntry ? (
                <section className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-body font-semibold">
                      {t("paymentSettlement.detail.journal")}
                    </h3>
                    <span className="flex flex-wrap gap-3 text-caption">
                      <RecordLink
                        kind="JOURNAL_ENTRY"
                        id={detail.journalEntry.id}
                        label={detail.journalEntry.entryNumber}
                      />
                      {detail.reversalJournalEntry ? (
                        <span className="flex items-center gap-1">
                          <span className="text-muted-foreground">
                            {t("paymentSettlement.detail.reversal")}
                          </span>
                          <RecordLink
                            kind="JOURNAL_ENTRY"
                            id={detail.reversalJournalEntry.id}
                            label={detail.reversalJournalEntry.entryNumber}
                          />
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <SettlementJournalTable
                    currency={functionalCode}
                    totalDebit={detail.journalEntry.totalDebit}
                    totalCredit={detail.journalEntry.totalCredit}
                    lines={detail.journalEntry.lines.map((line, index) => ({
                      key: `${line.account.id}-${index}`,
                      account: line.account,
                      description: line.description,
                      debit: line.debit,
                      credit: line.credit,
                    }))}
                  />
                </section>
              ) : null}

              {basis ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-body font-semibold">
                    {t("paymentSettlement.detail.conversionBasis")}
                  </h3>
                  <RatesSummary
                    rates={[basis.claimRate, basis.receivedRate]}
                    functionalCode={functionalCode}
                  />
                  <p className="text-caption text-muted-foreground">
                    {t("paymentSettlement.detail.feeBasis")}:{" "}
                    {t(`paymentSettlement.preview.feeBasis.${basis.feeBasis}`)}
                  </p>
                </section>
              ) : null}

              {detail.notes ? (
                <section className="flex flex-col gap-1">
                  <h3 className="text-body font-semibold">{t("paymentSettlement.detail.notes")}</h3>
                  <p className="whitespace-pre-line text-caption">{detail.notes}</p>
                </section>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ReverseSettlementDialog
        settlement={reverseOpen ? detail : null}
        onOpenChange={(open) => {
          if (!open) setReverseOpen(false);
        }}
        onReversed={(updated) => {
          setReverseOpen(false);
          setDetail(updated);
          onReversed();
        }}
      />
    </>
  );
}

/** Permissioned, audited reversal — a reason is required. */
export function ReverseSettlementDialog({
  settlement,
  onOpenChange,
  onReversed,
}: {
  settlement: { id: string; settlementNumber: string } | null;
  onOpenChange: (open: boolean) => void;
  onReversed: (updated: SettlementDetail) => void;
}) {
  const { t } = useLocale();
  const [reason, setReason] = useState("");
  const [isReversing, setIsReversing] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (settlement) setReason("");
  }, [settlement]);

  return (
    <ConfirmationDialog
      open={!!settlement}
      onOpenChange={onOpenChange}
      tone="destructive"
      title={t("paymentSettlement.reverse.title", { number: settlement?.settlementNumber ?? "" })}
      description={t("paymentSettlement.reverse.description")}
      confirmLabel={t("paymentSettlement.reverse.action")}
      confirmDisabled={reason.trim() === ""}
      isConfirming={isReversing}
      extra={
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settlement-reverse-reason">{t("paymentSettlement.reverse.reason")}</Label>
          <Textarea
            id="settlement-reverse-reason"
            value={reason}
            placeholder={t("paymentSettlement.reverse.reasonPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      }
      onConfirm={() => {
        if (!settlement || !reason.trim() || isReversing) return;
        setIsReversing(true);
        paymentSettlementsService
          .reverse(settlement.id, reason.trim())
          .then((updated) => {
            toast.success(
              t("paymentSettlement.reverse.success", { number: updated.settlementNumber }),
            );
            onReversed(updated);
          })
          .catch((error: unknown) => {
            toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
          })
          .finally(() => setIsReversing(false));
      }}
    />
  );
}
