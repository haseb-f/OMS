"use client";

import { EmptyState } from "@/components/shared/empty-state";
import { useLocale } from "@/providers/locale-provider";

/**
 * "Every page checks View permission. Otherwise: 403 Access Denied." One
 * shared full-page state (`EmptyState tone="denied"`), reused by every
 * `PermissionGate`; never a bespoke per-page "you can't be here" message.
 */
export function AccessDenied() {
  const { t } = useLocale();
  return (
    <EmptyState
      tone="denied"
      layout="page"
      title={t("accessDenied.title")}
      description={t("accessDenied.description")}
    />
  );
}
