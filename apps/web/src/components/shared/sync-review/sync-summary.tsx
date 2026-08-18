"use client";

import { FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Copy } from "lucide-react";
import { KpiCard } from "@/components/shared/kpi-card";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { countByStatus, type SyncReviewRow, type SyncReviewStatusFilter } from "./types";

export function SyncSummary({
  rows,
  filter,
  onFilterChange,
}: {
  rows: SyncReviewRow[];
  filter: SyncReviewStatusFilter;
  onFilterChange: (next: SyncReviewStatusFilter) => void;
}) {
  const { t } = useLocale();
  const counts = countByStatus(rows);

  const cards: Array<{
    id: SyncReviewStatusFilter;
    label: string;
    value: number;
    tone: "muted" | "success" | "warning" | "destructive" | "info";
    icon: typeof FileSpreadsheet;
  }> = [
    {
      id: "ALL",
      label: t("importCenter.sync.review.kpiTotal"),
      value: counts.total,
      tone: "muted",
      icon: FileSpreadsheet,
    },
    {
      id: "READY",
      label: t("importCenter.sync.review.kpiReady"),
      value: counts.READY,
      tone: "success",
      icon: CheckCircle2,
    },
    {
      id: "WARNING",
      label: t("importCenter.sync.review.kpiWarning"),
      value: counts.WARNING,
      tone: "warning",
      icon: AlertTriangle,
    },
    {
      id: "ERROR",
      label: t("importCenter.sync.review.kpiError"),
      value: counts.ERROR,
      tone: "destructive",
      icon: XCircle,
    },
    {
      id: "DUPLICATE",
      label: t("importCenter.sync.review.kpiDuplicate"),
      value: counts.DUPLICATE,
      tone: "info",
      icon: Copy,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          onClick={() => onFilterChange(card.id)}
          className={cn(
            "rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
            filter === card.id && "ring-2 ring-primary",
          )}
        >
          <KpiCard icon={card.icon} label={card.label} value={card.value} tone={card.tone} />
        </button>
      ))}
    </div>
  );
}
