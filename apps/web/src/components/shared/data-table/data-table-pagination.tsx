"use client";

import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/providers/locale-provider";

export function EnterprisePagination<TData>({ table }: { table: Table<TData> }) {
  const { t } = useLocale();
  const selectedCount = table.getFilteredSelectedRowModel().rows.length;
  const totalCount = table.options.rowCount ?? table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-caption text-muted-foreground">
        {table.options.enableRowSelection && selectedCount > 0
          ? `${selectedCount} / ${totalCount} ${t("table.rowsSelected")}`
          : t("table.resultCount", { count: totalCount })}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">{t("table.rowsPerPage")}</span>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 30, 50].map((size) => (
                <SelectItem key={size} value={`${size}`}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="text-caption text-muted-foreground">
          {t("table.pageOf", {
            page: table.getState().pagination.pageIndex + 1,
            pageCount: table.getPageCount() || 1,
          })}
        </div>
        <div className="flex items-center gap-1">
          <EnterpriseButton
            variant="outline"
            size="icon-sm"
            aria-label={t("table.goToFirstPage")}
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft className="rtl:rotate-180" />
          </EnterpriseButton>
          <EnterpriseButton
            variant="outline"
            size="icon-sm"
            aria-label={t("table.goToPreviousPage")}
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="rtl:rotate-180" />
          </EnterpriseButton>
          <EnterpriseButton
            variant="outline"
            size="icon-sm"
            aria-label={t("table.goToNextPage")}
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="rtl:rotate-180" />
          </EnterpriseButton>
          <EnterpriseButton
            variant="outline"
            size="icon-sm"
            aria-label={t("table.goToLastPage")}
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight className="rtl:rotate-180" />
          </EnterpriseButton>
        </div>
      </div>
    </div>
  );
}
