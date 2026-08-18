"use client";

import type { StatusTone } from "@/components/business/status-badge";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import { syncStatusLabelKey } from "./messages";
import type { SyncReviewStatus } from "./types";

const TONE: Record<SyncReviewStatus, StatusTone> = {
  READY: "success",
  WARNING: "warning",
  ERROR: "destructive",
  DUPLICATE: "info",
};

export function SyncStatusBadge({ status }: { status: SyncReviewStatus }) {
  const { t } = useLocale();
  return <StatusBadge label={t(syncStatusLabelKey(status))} tone={TONE[status]} />;
}

export function syncStatusTone(status: SyncReviewStatus): StatusTone {
  return TONE[status];
}
