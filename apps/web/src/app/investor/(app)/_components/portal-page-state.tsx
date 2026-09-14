import type { ReactNode } from "react";
import { AlertCircle, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";

/**
 * Standard loading / error / empty / content branching for every Portal
 * page — never a raw backend error surfaced to the investor (mission Part
 * 98), always a retry action on failure.
 */
export function PortalPageState({
  isLoading,
  error,
  isEmpty,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: Error | null;
  isEmpty?: boolean;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t("investorPortal.common.loadFailed")}
        action={
          <EnterpriseButton variant="outline" size="sm" onClick={onRetry}>
            {t("investorPortal.common.retry")}
          </EnterpriseButton>
        }
      />
    );
  }

  if (isEmpty && emptyIcon && emptyTitle) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return <>{children}</>;
}
