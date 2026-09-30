"use client";

import { StatusBadge } from "@/components/business/status-badge";
import {
  claimTerm,
  paymentRecordTerm,
  paymentTerm,
  settlementTerm,
  statementLineTerm,
  type PaymentTerm,
  type StatementLineStatusValue,
} from "@/config/payments/payment-vocabulary";
import { useLocale } from "@/providers/locale-provider";

/**
 * The payment-state pill — the shared `StatusBadge` fed by the one payment
 * vocabulary. Only the settled-to-bank state carries an icon (the bank);
 * every other state is named by its label and tone alone.
 */
export function PaymentTermBadge({
  term,
  fallback,
  withDescription = false,
  className,
}: {
  term: PaymentTerm | null;
  /** Shown neutrally when a code has no term (unknown API value). */
  fallback?: string;
  /** Adds the one-line meaning as the native tooltip. */
  withDescription?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  if (!term) {
    return fallback ? <StatusBadge label={fallback} tone="neutral" className={className} /> : null;
  }
  const definition = paymentTerm(term);
  const badge = (
    <StatusBadge
      label={t(definition.labelKey)}
      tone={definition.tone}
      icon={term === "SETTLED" ? definition.icon : undefined}
      className={className}
    />
  );
  return withDescription ? (
    <span className="inline-flex max-w-full min-w-0" title={t(definition.descriptionKey)}>
      {badge}
    </span>
  ) : (
    badge
  );
}

/** A payment declaration/claim record status (`PENDING | MATCHED | VERIFIED | REJECTED | DISPUTED`). */
export function PaymentRecordBadge({ status }: { status: string }) {
  return <PaymentTermBadge term={paymentRecordTerm(status)} fallback={status} withDescription />;
}

/** A claim's most advanced state: a posted claim shows its settlement state once it has one. */
export function PaymentClaimBadge({
  status,
  settlementStatus,
}: {
  status: string;
  settlementStatus?: string | null;
}) {
  return (
    <PaymentTermBadge
      term={claimTerm({ status, settlementStatus })}
      fallback={status}
      withDescription
    />
  );
}

/** Provider settlement of a posted claim; renders nothing when there is nothing to settle. */
export function PaymentSettlementBadge({ status }: { status: string | null | undefined }) {
  return <PaymentTermBadge term={settlementTerm(status)} withDescription />;
}

export function StatementLineBadge({ status }: { status: StatementLineStatusValue }) {
  return <PaymentTermBadge term={statementLineTerm(status)} withDescription />;
}
