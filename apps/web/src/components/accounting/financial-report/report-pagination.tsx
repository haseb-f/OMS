"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";

/**
 * Page strip under a paged report grid (General Ledger accounts, Journal
 * Report entries) — the range label says exactly which slice is shown, so a
 * report never stops silently at a page size.
 */
export function ReportPagination({
  rangeLabel,
  page,
  pageCount,
  isLoading,
  onPageChange,
}: {
  rangeLabel: string;
  page: number;
  pageCount: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
}) {
  const { t } = useLocale();
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-caption text-muted-foreground">
      <span>{rangeLabel}</span>
      <EnterpriseButton
        type="button"
        size="sm"
        variant="outline"
        disabled={page <= 1 || isLoading}
        onClick={() => onPageChange(page - 1)}
        aria-label={t("common.previous")}
      >
        <ChevronRight className="size-3.5 ltr:rotate-180" />
      </EnterpriseButton>
      <EnterpriseButton
        type="button"
        size="sm"
        variant="outline"
        disabled={page >= pageCount || isLoading}
        onClick={() => onPageChange(page + 1)}
        aria-label={t("common.next")}
      >
        <ChevronLeft className="size-3.5 ltr:rotate-180" />
      </EnterpriseButton>
    </div>
  );
}
