"use client";

import { Fragment } from "react";
import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/providers/locale-provider";

/** The page sizes every list offers (design-system §6). */
export const TABLE_PAGE_SIZES = [20, 50, 100] as const;

/** Maps any stored/legacy page size onto the offered set (smallest size that shows at least as many rows). */
export function normalizeTablePageSize(size: number): number {
  if ((TABLE_PAGE_SIZES as readonly number[]).includes(size)) return size;
  return TABLE_PAGE_SIZES.find((option) => option >= size) ?? TABLE_PAGE_SIZES[0];
}

/**
 * Renders a translated template ("{range} of {total}") with each figure in
 * its own isolated `num` run, so "1–20" never reorders inside Arabic text.
 */
function renderFigures(template: string, figures: Record<string, string>) {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const token = /^\{(\w+)\}$/.exec(part)?.[1];
    if (token && token in figures) {
      return (
        <span key={index} className="num">
          {figures[token]}
        </span>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function EnterprisePagination<TData>({
  table,
  showSelectionCount = true,
}: {
  table: Table<TData>;
  /**
   * Whether the selection count replaces the range label while rows are
   * selected. Off when a bulk-action strip already shows the count — the
   * count is shown once (design-system §6).
   */
  showSelectionCount?: boolean;
}) {
  const { t } = useLocale();
  const selectedCount = Object.keys(table.getState().rowSelection).length;
  const totalCount = table.options.rowCount ?? table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const from = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(totalCount, (pageIndex + 1) * pageSize);
  const pageSizes: number[] = (TABLE_PAGE_SIZES as readonly number[]).includes(pageSize)
    ? [...TABLE_PAGE_SIZES]
    : [...TABLE_PAGE_SIZES, pageSize].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <div className="text-caption text-muted-foreground" aria-live="polite">
        {showSelectionCount && table.options.enableRowSelection && selectedCount > 0
          ? renderFigures(t("table.selectedOfTotal"), {
              selected: String(selectedCount),
              total: String(totalCount),
            })
          : renderFigures(t("table.rangeOf"), {
              range: `${from}–${to}`,
              total: String(totalCount),
            })}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="hidden text-caption text-muted-foreground sm:inline">
            {t("table.rowsPerPage")}
          </span>
          <Select value={`${pageSize}`} onValueChange={(value) => table.setPageSize(Number(value))}>
            <SelectTrigger size="sm" aria-label={t("table.rowsPerPage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={`${size}`}>
                  <span className="num">{size}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden text-caption text-muted-foreground sm:block">
          {renderFigures(t("table.pageOf"), {
            page: String(pageIndex + 1),
            pageCount: String(table.getPageCount() || 1),
          })}
        </div>
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <ButtonGroup>
                <PaginationLink
                  variant="outline"
                  aria-label={t("table.goToFirstPage")}
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronsLeft className="rtl:rotate-180" />
                </PaginationLink>
                <PaginationLink
                  variant="outline"
                  aria-label={t("table.goToPreviousPage")}
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronLeft className="rtl:rotate-180" />
                </PaginationLink>
                <PaginationLink
                  variant="outline"
                  aria-label={t("table.goToNextPage")}
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronRight className="rtl:rotate-180" />
                </PaginationLink>
                <PaginationLink
                  variant="outline"
                  aria-label={t("table.goToLastPage")}
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronsRight className="rtl:rotate-180" />
                </PaginationLink>
              </ButtonGroup>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
