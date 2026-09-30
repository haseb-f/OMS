"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitCompareArrows, Plus, X } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalFieldFullWidth, ModalSection } from "@/components/shared/modal-section";
import { SearchInput } from "@/components/shared/search-input";
import { RelatedRecordLink } from "@/components/shared/record-preview";
import { StatusBadge } from "@/components/business/status-badge";
import { PaymentRecordBadge } from "@/components/payments/payment-term-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import {
  paymentReconciliationService,
  type ClaimView,
} from "@/services/payment-reconciliation-service";
import {
  defaultAllocationAmount,
  newIdempotencyKey,
  validateAllocations,
  willPost,
} from "./reconciliation-model";

export interface AllocationLine {
  id: string;
  providerReference: string | null;
  remaining: number;
  currency: { id: string; code: string };
}

interface Draft {
  claim: ClaimView;
  amount: string;
}

/** Claim → order → customer identity row, shared by suggestions and the allocation dialog. */
export function ClaimIdentity({ claim }: { claim: ClaimView }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <RelatedRecordLink kind="PAYMENT" id={claim.id} number={claim.paymentNumber} />
      {claim.storeOrder ? (
        <RelatedRecordLink
          kind="STORE_ORDER"
          id={claim.storeOrder.id}
          number={claim.storeOrder.internalOrderId}
        />
      ) : null}
      {claim.customer ? (
        <RelatedRecordLink kind="CUSTOMER" id={claim.customer.id} number={claim.customer.name} />
      ) : null}
      <PaymentRecordBadge status={claim.status} />
      <span className="text-caption text-muted-foreground" dir="ltr">
        {formatDate(claim.paymentDate)}
        {claim.referenceNumber ? ` · ${claim.referenceNumber}` : ""}
      </span>
    </div>
  );
}

/**
 * Explicit allocation of one statement line to one or more claims (partial
 * and multiple allocations). One idempotency key per opened dialog: a retry
 * or double-click of "Confirm match & post" returns the same result instead
 * of allocating twice.
 */
export function AllocationDialog({
  methodId,
  line,
  initialClaims,
  onClose,
  onDone,
}: {
  methodId: string;
  line: AllocationLine;
  initialClaims: ClaimView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    let allocated = 0;
    return initialClaims.map((claim) => {
      const amount = defaultAllocationAmount(line.remaining, allocated, claim.remaining);
      allocated += amount;
      return { claim, amount: amount.toFixed(2) };
    });
  });
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ClaimView[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      paymentReconciliationService
        .searchClaims(methodId, { search: search || undefined, currencyId: line.currency.id })
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch((error: unknown) => reportApiError(error, t("common.loadFailed")));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [methodId, search, line.currency.id, t]);

  const parsed = drafts.map((draft) => ({
    paymentId: draft.claim.id,
    remaining: draft.claim.remaining,
    amount: Number(draft.amount),
  }));
  const validation = validateAllocations(line.remaining, parsed);
  const selectedIds = useMemo(() => new Set(drafts.map((d) => d.claim.id)), [drafts]);

  const add = (claim: ClaimView) => {
    const allocated = parsed.reduce((sum, draft) => sum + (draft.amount || 0), 0);
    const amount = defaultAllocationAmount(line.remaining, allocated, claim.remaining);
    setDrafts((current) => [...current, { claim, amount: amount.toFixed(2) }]);
  };

  const confirm = async () => {
    if (validation.error) return;
    setBusy(true);
    try {
      const result = await paymentReconciliationService.confirmMatch(methodId, {
        statementLineId: line.id,
        allocations: parsed.map(({ paymentId, amount }) => ({ paymentId, amount })),
        idempotencyKey,
      });
      const posted = result.postings.filter((posting) => posting.posted).length;
      if (result.replayed) toast.info(t("paymentReconciliation.allocation.replayed"));
      else if (posted > 0) {
        toast.success(t("paymentReconciliation.allocation.done", { posted: String(posted) }));
      } else toast.success(t("paymentReconciliation.allocation.donePartial"));
      onDone();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      icon={GitCompareArrows}
      title={t("paymentReconciliation.allocation.title")}
      description={t("paymentReconciliation.allocation.description", {
        reference: line.providerReference ?? "—",
        amount: formatMoney(line.remaining, line.currency.code),
      })}
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="ghost" onClick={requestClose} disabled={busy}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            variant="success"
            onClick={() => void confirm()}
            disabled={busy || !!validation.error}
            isLoading={busy}
          >
            <CheckCircle2 />
            {t("paymentReconciliation.allocation.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <ModalSection title={t("paymentReconciliation.allocation.selected")}>
          <ModalFieldFullWidth className="flex flex-col gap-2">
            {drafts.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("paymentReconciliation.allocation.none")}
              </p>
            ) : (
              drafts.map((draft, index) => {
                const current = parsed[index];
                return (
                  <div
                    key={draft.claim.id}
                    className="flex flex-col gap-2 rounded-sm border border-border p-2 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <ClaimIdentity claim={draft.claim} />
                      <span className="text-caption text-muted-foreground" dir="ltr">
                        {t("paymentReconciliation.fields.remaining")}{" "}
                        {formatMoney(draft.claim.remaining, draft.claim.currency.code)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        dir="ltr"
                        inputMode="decimal"
                        className="w-32"
                        aria-label={t("paymentReconciliation.fields.amount")}
                        value={draft.amount}
                        onChange={(event) =>
                          setDrafts((all) =>
                            all.map((item, i) =>
                              i === index ? { ...item, amount: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <StatusBadge
                        label={
                          willPost(current)
                            ? t("paymentReconciliation.allocation.willPost")
                            : t("paymentReconciliation.allocation.staysMatched")
                        }
                        tone={willPost(current) ? "success" : "warning"}
                      />
                      <EnterpriseButton
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("paymentReconciliation.allocation.remove")}
                        onClick={() => setDrafts((all) => all.filter((_, i) => i !== index))}
                      >
                        <X />
                      </EnterpriseButton>
                    </div>
                  </div>
                );
              })
            )}
            <p className="text-caption tabular-nums" dir="auto">
              {t("paymentReconciliation.allocation.total", {
                total: formatMoney(validation.total, line.currency.code),
                leftover: formatMoney(validation.leftover, line.currency.code),
              })}
            </p>
            {validation.error ? (
              <p className="text-caption text-destructive">
                {t(`paymentReconciliation.allocation.errors.${validation.error}`)}
              </p>
            ) : null}
          </ModalFieldFullWidth>
        </ModalSection>

        <ModalSection title={t("paymentReconciliation.matching.claimsTitle")}>
          <ModalFieldFullWidth className="flex flex-col gap-2">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t("paymentReconciliation.allocation.searchPlaceholder")}
            />
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {results
                .filter((claim) => !selectedIds.has(claim.id))
                .map((claim) => (
                  <div
                    key={claim.id}
                    className="flex flex-col gap-1 rounded-sm border border-border p-2 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <ClaimIdentity claim={claim} />
                    </div>
                    <span className="text-body font-medium tabular-nums" dir="ltr">
                      {formatMoney(claim.remaining, claim.currency.code)}
                    </span>
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => add(claim)}
                    >
                      <Plus />
                      {t("paymentReconciliation.allocation.add")}
                    </EnterpriseButton>
                  </div>
                ))}
              {results.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t("paymentReconciliation.matching.claimsEmpty")}
                </p>
              ) : null}
            </div>
          </ModalFieldFullWidth>
        </ModalSection>
      </div>
    </EnterpriseModal>
  );
}
