"use client";

import type { StatusTone } from "@/components/business/status-badge";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import { syncLifecycleLabelKey, syncStatusLabelKey } from "./messages";
import type { SyncReviewLifecycle, SyncReviewRow, SyncReviewStatus } from "./types";

const TONE: Record<SyncReviewStatus, StatusTone> = {
  READY: "success",
  WARNING: "warning",
  ERROR: "destructive",
  DUPLICATE: "info",
};

const LIFECYCLE_TONE: Record<SyncReviewLifecycle, StatusTone> = {
  NEW: "info",
  RETRY: "warning",
  IMPORTED: "success",
  UNCHANGED_FAILURE: "neutral",
  ORPHAN_LINK: "destructive",
  MODIFIED: "warning",
  DELETED: "warning",
};

export function SyncStatusBadge({
  status,
  lifecycle,
}: {
  status: SyncReviewStatus;
  lifecycle?: SyncReviewLifecycle;
}) {
  const { t } = useLocale();
  if (
    lifecycle &&
    (status === "READY" ||
      lifecycle === "RETRY" ||
      lifecycle === "MODIFIED" ||
      lifecycle === "DELETED")
  ) {
    return (
      <StatusBadge
        label={t(
          syncLifecycleLabelKey(lifecycle === "RETRY" && status !== "READY" ? "RETRY" : lifecycle),
        )}
        tone={status === "ERROR" ? "destructive" : LIFECYCLE_TONE[lifecycle]}
      />
    );
  }
  return <StatusBadge label={t(syncStatusLabelKey(status))} tone={TONE[status]} />;
}

export function SyncRowStatusBadge({ row }: { row: SyncReviewRow }) {
  return <SyncStatusBadge status={row.status} lifecycle={row.lifecycle} />;
}

export function syncStatusTone(status: SyncReviewStatus): StatusTone {
  return TONE[status];
}
