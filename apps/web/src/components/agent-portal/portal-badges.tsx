"use client";

import { StatusBadge } from "@/components/business/status-badge";
import {
  declaredStatusTone,
  financeStatusTone,
  fulfillmentCodeLabelKey,
  leadCodeLabelKey,
  paymentStageTone,
  verificationTone,
} from "@/config/agent-portal/labels";
import { useLocale } from "@/providers/locale-provider";
import type {
  CatalogStatus,
  ClaimVerification,
  DeclaredPaymentStatus,
  DestinationOwnership,
  FinancePaymentStatus,
  PortalPaymentStage,
} from "@/services/agent-portal-service";

/** What sales declared — never styled as a verification. */
export function DeclaredStatusBadge({ status }: { status: DeclaredPaymentStatus }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`agentPortal.status.declared.${status}`)}
      tone={declaredStatusTone(status)}
    />
  );
}

/** Finance's own payment status of the order. */
export function FinanceStatusBadge({ status }: { status: FinancePaymentStatus }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`agentPortal.status.finance.${status}`)}
      tone={financeStatusTone(status)}
    />
  );
}

/** Store-order fulfillment status: the portal's label for known codes, else the catalog name. */
export function FulfillmentStatusBadge({ status }: { status: CatalogStatus | null }) {
  const { t, locale } = useLocale();
  if (!status) return <span className="text-muted-foreground">—</span>;
  const key = fulfillmentCodeLabelKey(status.code);
  const label = key ? t(key) : locale === "en" && status.nameEn ? status.nameEn : status.name;
  return <StatusBadge label={label} colorKey={status.color} />;
}

export function LeadStatusBadge({ status }: { status: CatalogStatus }) {
  const { t, locale } = useLocale();
  const key = leadCodeLabelKey(status.code);
  const label = key ? t(key) : locale === "en" && status.nameEn ? status.nameEn : status.name;
  return <StatusBadge label={label} colorKey={status.color} />;
}

export function VerificationBadge({ verification }: { verification: ClaimVerification }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`agentPortal.status.verification.${verification}`)}
      tone={verificationTone(verification)}
    />
  );
}

export function PaymentStageBadge({ stage }: { stage: PortalPaymentStage }) {
  const { t } = useLocale();
  return (
    <StatusBadge label={t(`agentPortal.status.stage.${stage}`)} tone={paymentStageTone(stage)} />
  );
}

/** "حساب الشركة" / "حساب الوكيل" — who received the money. */
export function OwnershipBadge({ ownership }: { ownership: DestinationOwnership }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`agentPortal.status.ownership.${ownership}`)}
      tone={ownership === "COMPANY" ? "info" : "neutral"}
    />
  );
}
