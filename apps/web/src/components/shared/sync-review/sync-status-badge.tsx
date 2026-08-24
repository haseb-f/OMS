"use client";

import type { StatusTone } from "@/components/business/status-badge";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import { syncLifecycleLabelKey, syncStatusLabelKey } from "./messages";
import { defaultDecision } from "./types";
import type {
  SyncReviewDecision,
  SyncReviewLifecycle,
  SyncReviewRow,
  SyncReviewStatus,
} from "./types";

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
  EXTERNAL_DUP: "destructive",
  PHONE_MATCH: "warning",
  DELETED: "warning",
};

export function SyncStatusBadge({
  status,
  lifecycle,
  decision,
}: {
  status: SyncReviewStatus;
  lifecycle?: SyncReviewLifecycle;
  /**
   * Part 6 — a PHONE_MATCH row's badge must show what will actually happen,
   * not just "this row matched a phone": pending vs. already-staged
   * accept/reject are visually distinct so the operator never mistakes a
   * still-undecided row for one that's been handled.
   */
  decision?: SyncReviewDecision;
}) {
  const { t } = useLocale();
  if (lifecycle === "EXTERNAL_DUP") {
    // Re-Sync Eligibility — never a rejection: the row's External Order ID
    // already maps to a real OMS order, so it was safely re-linked (never
    // duplicated). A calm "resolved" tone, not the neutral "مكرر" a same-file
    // duplicate group gets.
    return (
      <StatusBadge label={t("importCenter.sync.review.externalDupReconciled")} tone="success" />
    );
  }
  if (lifecycle === "PHONE_MATCH") {
    const effectiveDecision = decision ?? "PENDING";
    const label =
      effectiveDecision === "ACCEPT"
        ? t("importCenter.sync.review.phoneMatchAccepted")
        : effectiveDecision === "REJECT"
          ? t("importCenter.sync.review.phoneMatchRejected")
          : t(syncLifecycleLabelKey("PHONE_MATCH"));
    const tone: StatusTone =
      effectiveDecision === "ACCEPT"
        ? "success"
        : effectiveDecision === "REJECT"
          ? "destructive"
          : "warning";
    return <StatusBadge label={label} tone={tone} />;
  }
  if (lifecycle && (status === "READY" || lifecycle === "RETRY" || lifecycle === "DELETED")) {
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

export function SyncRowStatusBadge({
  row,
  decision,
}: {
  row: SyncReviewRow;
  decision?: SyncReviewDecision;
}) {
  return (
    <SyncStatusBadge
      status={row.status}
      lifecycle={row.lifecycle}
      decision={decision ?? defaultDecision(row)}
    />
  );
}

export function syncStatusTone(status: SyncReviewStatus): StatusTone {
  return TONE[status];
}
