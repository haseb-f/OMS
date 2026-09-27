"use client";

import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/providers/locale-provider";

/** Recoverable failure — `EmptyState tone="error"`, with Retry when `onRetry` is passed. */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const { t } = useLocale();

  return (
    <EmptyState
      tone="error"
      title={title ?? t("common.loadFailed")}
      description={description}
      className={className}
      action={
        onRetry ? (
          <EnterpriseButton type="button" variant="outline" size="sm" onClick={onRetry}>
            {retryLabel ?? t("common.retry")}
          </EnterpriseButton>
        ) : undefined
      }
    />
  );
}
