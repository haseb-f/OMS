"use client";

import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import { KpiCard } from "@/components/shared/kpi-card";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { countByStatus, type SyncReviewRow, type SyncReviewStatusFilter } from "./types";
import type { SyncPreviewIncremental } from "@/services/sync-service";

export function SyncSummary({
  rows,
  filter,
  onFilterChange,
  incremental,
}: {
  rows: SyncReviewRow[];
  filter: SyncReviewStatusFilter;
  onFilterChange: (next: SyncReviewStatusFilter) => void;
  incremental?: SyncPreviewIncremental | null;
}) {
  const { t } = useLocale();
  const counts = countByStatus(rows);

  const cards: Array<{
    id: SyncReviewStatusFilter | "SKIPPED";
    label: string;
    value: number;
    tone: "muted" | "success" | "warning" | "destructive" | "info";
    icon: typeof FileSpreadsheet;
    filterable: boolean;
  }> = incremental
    ? [
        {
          id: "NEW",
          label: t("importCenter.sync.review.kpiNew"),
          value: incremental.newCount,
          tone: "info",
          icon: FileSpreadsheet,
          filterable: true,
        },
        {
          id: "RETRY",
          label: t("importCenter.sync.review.kpiRetry"),
          value: incremental.retryCount,
          tone: "warning",
          icon: RotateCcw,
          filterable: true,
        },
        {
          id: "ERROR",
          label: t("importCenter.sync.review.kpiError"),
          value: incremental.errorCount,
          tone: "destructive",
          icon: XCircle,
          filterable: true,
        },
        {
          id: "READY",
          label: t("importCenter.sync.review.kpiReady"),
          value: incremental.readyCount,
          tone: "success",
          icon: CheckCircle2,
          filterable: true,
        },
        {
          id: "SKIPPED",
          label: t("importCenter.sync.review.kpiSkipped"),
          value: incremental.importedSkippedCount + incremental.unchangedSkippedCount,
          tone: "muted",
          icon: SkipForward,
          filterable: false,
        },
      ]
    : [
        {
          id: "ALL",
          label: t("importCenter.sync.review.kpiTotal"),
          value: counts.total,
          tone: "muted",
          icon: FileSpreadsheet,
          filterable: true,
        },
        {
          id: "READY",
          label: t("importCenter.sync.review.kpiReady"),
          value: counts.READY,
          tone: "success",
          icon: CheckCircle2,
          filterable: true,
        },
        {
          id: "WARNING",
          label: t("importCenter.sync.review.kpiWarning"),
          value: counts.WARNING,
          tone: "warning",
          icon: AlertTriangle,
          filterable: true,
        },
        {
          id: "ERROR",
          label: t("importCenter.sync.review.kpiError"),
          value: counts.ERROR,
          tone: "destructive",
          icon: XCircle,
          filterable: true,
        },
        {
          id: "DUPLICATE",
          label: t("importCenter.sync.review.kpiDuplicate"),
          value: counts.DUPLICATE,
          tone: "info",
          icon: FileSpreadsheet,
          filterable: true,
        },
      ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          disabled={!card.filterable}
          onClick={() => {
            if (card.filterable && card.id !== "SKIPPED") onFilterChange(card.id);
          }}
          className={cn(
            "rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
            card.filterable && filter === card.id && "ring-2 ring-primary",
            !card.filterable && "cursor-default",
          )}
        >
          <KpiCard icon={card.icon} label={card.label} value={card.value} tone={card.tone} />
        </button>
      ))}
    </div>
  );
}
