import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
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
      <ErrorState
        title={t("investorPortal.common.loadFailed")}
        retryLabel={t("investorPortal.common.retry")}
        onRetry={onRetry}
      />
    );
  }

  if (isEmpty && emptyIcon && emptyTitle) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return <>{children}</>;
}
