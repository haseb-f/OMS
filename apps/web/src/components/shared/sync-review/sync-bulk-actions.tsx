"use client";

import { Check, Download, Eraser, RotateCcw, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import type { SyncReviewStatusFilter } from "./types";

export function SyncBulkActions({
  selectedCount,
  importableSelectedCount,
  errorCount,
  retryableSelectedCount,
  retryableCount,
  filter,
  onAcceptSelected,
  onAcceptReady,
  onRejectSelected,
  onDownloadErrors,
  onSelectCurrentStatus,
  onRetrySelected,
  onRetryEligible,
  orphanSelectedCount,
  onClearOrphanResults,
}: {
  selectedCount: number;
  importableSelectedCount: number;
  errorCount: number;
  retryableSelectedCount?: number;
  retryableCount?: number;
  filter: SyncReviewStatusFilter;
  onAcceptSelected: () => void;
  onAcceptReady: () => void;
  onRejectSelected: () => void;
  onDownloadErrors: () => void;
  onSelectCurrentStatus: () => void;
  onRetrySelected?: () => void;
  onRetryEligible?: () => void;
  orphanSelectedCount?: number;
  onClearOrphanResults?: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filter !== "ALL" ? (
        <EnterpriseButton type="button" variant="ghost" size="sm" onClick={onSelectCurrentStatus}>
          {t("importCenter.sync.review.bulkSelectStatus")}
        </EnterpriseButton>
      ) : null}
      {(filter === "ALL" || filter === "READY" || filter === "WARNING") && (
        <>
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            disabled={importableSelectedCount === 0}
            onClick={onAcceptSelected}
          >
            <Check />
            {t("importCenter.sync.review.bulkAcceptSelected")}
          </EnterpriseButton>
          {filter !== "WARNING" ? (
            <EnterpriseButton type="button" variant="outline" size="sm" onClick={onAcceptReady}>
              <Check />
              {t("importCenter.sync.review.bulkAcceptReady")}
            </EnterpriseButton>
          ) : null}
        </>
      )}
      <EnterpriseButton
        type="button"
        variant="destructive"
        size="sm"
        disabled={selectedCount === 0}
        onClick={onRejectSelected}
      >
        <X />
        {t("importCenter.sync.review.bulkRejectSelected")}
      </EnterpriseButton>
      {onClearOrphanResults && (orphanSelectedCount ?? 0) > 0 ? (
        <EnterpriseButton type="button" variant="outline" size="sm" onClick={onClearOrphanResults}>
          <Eraser />
          {t("importCenter.sync.review.bulkClearOrphanResults")}
        </EnterpriseButton>
      ) : null}
      {errorCount > 0 ? (
        <EnterpriseButton type="button" variant="outline" size="sm" onClick={onDownloadErrors}>
          <Download />
          {t("importCenter.sync.review.bulkDownloadErrors")}
        </EnterpriseButton>
      ) : null}
      {onRetrySelected ? (
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          disabled={(retryableSelectedCount ?? 0) === 0}
          onClick={onRetrySelected}
        >
          <RotateCcw />
          {t("importCenter.sync.review.bulkRetrySelected")}
        </EnterpriseButton>
      ) : null}
      {onRetryEligible && (retryableCount ?? 0) > 0 ? (
        <EnterpriseButton type="button" variant="outline" size="sm" onClick={onRetryEligible}>
          <RotateCcw />
          {t("importCenter.sync.review.bulkRetryEligible")}
        </EnterpriseButton>
      ) : null}
    </div>
  );
}
