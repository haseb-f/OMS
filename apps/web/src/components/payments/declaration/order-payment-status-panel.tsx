"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { DetailFieldRow, DetailGroup } from "@/components/shared/detail-workspace";
import { MoneyValue } from "@/components/shared/money-value";
import { StatusBadge } from "@/components/business/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { DeclaredPaymentStatus } from "./declaration-logic";
import { PaymentSettlementBadge } from "@/components/payments/payment-term-badge";
import {
  DECLARED_STATUS_TONE,
  VERIFICATION_TONE,
  declaredStatusLabelKey,
  financeVerificationState,
  settlementState,
} from "./declaration-status";

interface PanelClaim {
  status: string;
  settlementStatus?: string | null;
  paymentMethod?: { name: string } | null;
  paymentSource?: { name: string } | null;
}

/** Order-level discrepancy flag raised by Finance after fulfillment started. */
export function PaymentDiscrepancyAlert({ reason }: { reason?: string | null }) {
  const { t } = useLocale();
  return (
    <Alert tone="warning">
      <AlertTriangle />
      <div className="flex flex-col gap-0.5">
        <AlertTitle>{t("paymentDeclaration.discrepancy.title")}</AlertTitle>
        <AlertDescription>
          {t("paymentDeclaration.discrepancy.description")}
          {reason ? <span className="block">{reason}</span> : null}
        </AlertDescription>
      </div>
    </Alert>
  );
}

/**
 * The order's payment summary as three separate facts: declared by Sales,
 * verified/posted by Finance, provider settlement — never one "Paid" flag.
 */
export function OrderPaymentStatusPanel({
  declaredPaymentStatus,
  declaredAmount,
  paymentStatus,
  claims,
  verifiedAmount,
  remainingAmount,
  currency,
  actions,
  footer,
}: {
  declaredPaymentStatus?: DeclaredPaymentStatus;
  declaredAmount?: string | number;
  paymentStatus?: string | null;
  claims: PanelClaim[];
  verifiedAmount: number;
  remainingAmount: number;
  currency?: { code: string } | null;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useLocale();
  const verification = financeVerificationState(claims, paymentStatus);
  const settlement = settlementState(claims);
  const latestMethod = claims[0]?.paymentMethod?.name ?? claims[0]?.paymentSource?.name;

  return (
    <DetailGroup title={t("storeOrders.detail.sections.payments")} actions={actions}>
      <div className="flex flex-col divide-y divide-border/60">
        <div className="py-1">
          <p className="pt-1 text-caption font-semibold">
            {t("paymentDeclaration.sections.declared")}
          </p>
          <DetailFieldRow
            label={t("common.status")}
            value={
              <StatusBadge
                label={t(declaredStatusLabelKey(declaredPaymentStatus))}
                tone={DECLARED_STATUS_TONE[declaredPaymentStatus ?? "UNPAID"]}
              />
            }
          />
          <DetailFieldRow
            label={t("paymentDeclaration.fields.declaredAmount")}
            value={<MoneyValue value={declaredAmount ?? 0} currency={currency} />}
          />
          <DetailFieldRow label={t("paymentDeclaration.fields.method")} value={latestMethod} />
        </div>
        <div className="py-1">
          <p className="pt-1 text-caption font-semibold">
            {t("paymentDeclaration.sections.verification")}
          </p>
          <DetailFieldRow
            label={t("common.status")}
            value={
              <StatusBadge
                label={t(`paymentDeclaration.verification.${verification}` as MessageKey)}
                tone={VERIFICATION_TONE[verification]}
              />
            }
          />
          <DetailFieldRow
            label={t("paymentDeclaration.fields.verifiedAmount")}
            value={<MoneyValue value={verifiedAmount} currency={currency} />}
          />
          <DetailFieldRow
            label={t("storeOrders.detail.payments.remaining")}
            value={<MoneyValue value={remainingAmount} currency={currency} />}
          />
        </div>
        {settlement !== "NOT_APPLICABLE" ? (
          <div className="py-1">
            <p className="pt-1 text-caption font-semibold">
              {t("paymentDeclaration.sections.settlement")}
            </p>
            <DetailFieldRow
              label={t("common.status")}
              value={<PaymentSettlementBadge status={settlement} />}
            />
          </div>
        ) : null}
      </div>
      {footer}
    </DetailGroup>
  );
}
