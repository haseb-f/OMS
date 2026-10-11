"use client";

import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import { InsightCard, InsightGroup } from "@/components/shared/insight-card";
import { useLocale } from "@/providers/locale-provider";
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
  const { t, direction } = useLocale();
  const counts = countByStatus(rows);

  const cards: Array<{
    id: SyncReviewStatusFilter | "SKIPPED";
    label: string;
    value: number;
    tone: "neutral" | "success" | "warning" | "destructive" | "info";
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
          tone: "neutral",
          icon: SkipForward,
          filterable: false,
        },
      ]
    : [
        {
          id: "ALL",
          label: t("importCenter.sync.review.kpiTotal"),
          value: counts.total,
          tone: "neutral",
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

  // R17 §4: the shared report card — a filterable count is one button (`onSelect`; the active
  // filter is `pressed`: aria-pressed + the emphasis edge); a count that filters nothing is an
  // informational, unfocusable tile.
  return (
    <InsightGroup fit>
      {cards.map((card) => {
        const filterId = card.filterable && card.id !== "SKIPPED" ? card.id : null;
        return (
          <InsightCard
            key={card.id}
            icon={card.icon}
            label={card.label}
            value={card.value}
            tone={card.tone}
            direction={direction}
            onSelect={filterId ? () => onFilterChange(filterId) : undefined}
            pressed={filterId ? filter === filterId : undefined}
          />
        );
      })}
    </InsightGroup>
  );
}
