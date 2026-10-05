"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { renderFigures } from "@/components/shared/data-table/data-table-pagination";
import { useLocale } from "@/providers/locale-provider";

/**
 * Compact pager for a small, already-loaded list inside a dialog or a card
 * ("1–5 of 12", previous / next). The big tables keep `EnterprisePagination`
 * (page size, first / last); this is the same control language for a list that
 * has no TanStack table behind it. Renders nothing when everything fits.
 */
export function ListPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  /** Zero-based page index. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useLocale();
  if (total <= pageSize) return null;
  const pageCount = Math.ceil(total / pageSize);
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="list-pager">
      <div className="text-caption text-muted-foreground" aria-live="polite">
        {renderFigures(t("table.rangeOf"), { range: `${from}–${to}`, total: String(total) })}
      </div>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <ButtonGroup>
              <PaginationLink
                variant="outline"
                aria-label={t("table.goToPreviousPage")}
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 0}
              >
                <ChevronLeft className="rtl:rotate-180" />
              </PaginationLink>
              <PaginationLink
                variant="outline"
                aria-label={t("table.goToNextPage")}
                onClick={() => onPageChange(page + 1)}
                disabled={page >= pageCount - 1}
              >
                <ChevronRight className="rtl:rotate-180" />
              </PaginationLink>
            </ButtonGroup>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
