"use client";

import { CircleAlert } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/providers/locale-provider";

/** Recoverable failure — always pairs an explanation with Retry when `onRetry` is passed. */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { t } = useLocale();

  return (
    <EmptyState
      icon={CircleAlert}
      title={title ?? t("common.loadFailed")}
      description={description}
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
