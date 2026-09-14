import { EnterpriseBadge } from "@/components/ui/badge";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "info" | "destructive";

const OPPORTUNITY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  DRAFT: "secondary",
  OPEN: "info",
  FUNDED: "info",
  ACTIVE: "success",
  ENDED: "warning",
  SETTLED: "default",
  CLOSED: "secondary",
  CANCELLED: "secondary",
};

/** Reuses the Admin Opportunity module's exact `investors.opportunities.status.*` i18n keys — this enum's label is never re-invented per screen. */
export function OpportunityStatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const variant = OPPORTUNITY_STATUS_VARIANT[status] ?? "secondary";
  return (
    <EnterpriseBadge variant={variant}>
      {t(`investors.opportunities.status.${status}` as MessageKey)}
    </EnterpriseBadge>
  );
}

const DISTRIBUTION_STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING: "secondary",
  PAYABLE: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "secondary",
};

/** InvestorDistributionStatus — reuses the Admin Distributions tab's exact `investors.distributions.investorStatus.*` keys. */
export function DistributionStatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const variant = DISTRIBUTION_STATUS_VARIANT[status] ?? "secondary";
  return (
    <EnterpriseBadge variant={variant}>
      {t(`investors.distributions.investorStatus.${status}` as MessageKey)}
    </EnterpriseBadge>
  );
}

const SIMPLE_STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING: "secondary",
  CONFIRMED: "success",
  REJECTED: "destructive",
  CANCELLED: "secondary",
};

/** CapitalContributionStatus — reuses `investors.contributions.status.*`. */
export function ContributionStatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const variant = SIMPLE_STATUS_VARIANT[status] ?? "secondary";
  return (
    <EnterpriseBadge variant={variant}>
      {t(`investors.contributions.status.${status}` as MessageKey)}
    </EnterpriseBadge>
  );
}

/** DistributionPaymentStatus — reuses `investors.distributions.paymentStatus.*`. */
export function PaymentStatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  const variant = SIMPLE_STATUS_VARIANT[status] ?? "secondary";
  return (
    <EnterpriseBadge variant={variant}>
      {t(`investors.distributions.paymentStatus.${status}` as MessageKey)}
    </EnterpriseBadge>
  );
}
