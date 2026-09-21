"use client";

import { useState } from "react";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff, Filter, PinOff, Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EnterpriseButton } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/locale-provider";

type HeaderAlign = "start" | "center" | "end";

const TEXT_ALIGN: Record<HeaderAlign, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
};

/** Sortable + hideable + pinnable + filterable column header — the standard TanStack Table pairing with shadcn, extended (TASK-060B Part 3) with pinning, multi-sort, and a per-column sticky filter popover. */
export function EnterpriseTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  align = "start",
  canFilter = false,
  canMultiSort = false,
}: {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
  align?: HeaderAlign;
  /** Client-mode only — server-paginated tables don't have the full dataset loaded to filter locally. */
  canFilter?: boolean;
  /** Server mode only supports one sort field at a time, so multi-sort menu entries only make sense in client mode. */
  canMultiSort?: boolean;
}) {
  const { t } = useLocale();
  const [filterOpen, setFilterOpen] = useState(false);
  const isPinned = column.getIsPinned();
  const filterValue = (column.getFilterValue() as string | undefined) ?? "";
  const showFilterAffordance = canFilter && column.getCanFilter();

  const textAlign = TEXT_ALIGN[align];

  if (!column.getCanSort()) {
    if (!showFilterAffordance) {
      return (
        <span className={cn("block min-w-0 w-full truncate", textAlign, className)}>{title}</span>
      );
    }
    return (
      <div
        className={cn(
          "flex min-w-0 w-full items-center gap-1",
          align === "end" && "flex-row-reverse",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", textAlign)}>{title}</span>
        <ColumnFilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          value={filterValue}
          onChange={(value) => column.setFilterValue(value || undefined)}
          title={title}
        />
      </div>
    );
  }

  const isSorted = column.getIsSorted();
  const Icon = isSorted === "desc" ? ArrowDown : isSorted === "asc" ? ArrowUp : ChevronsUpDown;
  const sortIcon = (
    <Icon
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground/60 transition-opacity duration-150 group-hover/sort:opacity-100",
        !isSorted && "opacity-0 group-hover/sort:opacity-70",
        isSorted && "text-foreground opacity-100",
      )}
    />
  );
  const pinIcon = isPinned ? <Pin className="size-3 shrink-0 text-muted-foreground/70" /> : null;

  // The title always sits flush on the column's own alignment edge — the
  // same edge the body cells use. Sort/pin/filter affordances go on the
  // opposite side (or both sides when centered), so a hidden or visible
  // sort icon never shifts the title off the value axis.
  return (
    <div
      className={cn(
        "group/sort flex min-w-0 w-full items-center gap-0.5",
        align === "end" && "flex-row-reverse",
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EnterpriseButton
            variant="ghost"
            size="inline"
            className={cn(
              "flex min-w-0 flex-1 max-w-full items-center gap-0.5 font-medium text-caption leading-normal text-muted-foreground hover:bg-transparent hover:text-foreground hover:shadow-none data-[state=open]:bg-transparent data-[state=open]:text-foreground",
              align === "end" && "flex-row-reverse",
              align === "center" && "justify-center",
              align === "start" && "justify-start",
            )}
          >
            {align === "center" ? <span aria-hidden className="size-3.5 shrink-0" /> : null}
            <span className={cn("min-w-0 truncate", textAlign)}>{title}</span>
            {pinIcon}
            {sortIcon}
          </EnterpriseButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
            <ArrowUp className="text-muted-foreground/70" />
            {t("table.sortAscending")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
            <ArrowDown className="text-muted-foreground/70" />
            {t("table.sortDescending")}
          </DropdownMenuItem>
          {canMultiSort && (
            <>
              <DropdownMenuItem onClick={() => column.toggleSorting(false, true)}>
                <ArrowUp className="text-muted-foreground/70" />
                {t("table.addSortAscending")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => column.toggleSorting(true, true)}>
                <ArrowDown className="text-muted-foreground/70" />
                {t("table.addSortDescending")}
              </DropdownMenuItem>
            </>
          )}
          {isSorted && (
            <DropdownMenuItem onClick={() => column.clearSorting()}>
              <X className="text-muted-foreground/70" />
              {t("table.clearSort")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {isPinned ? (
            <DropdownMenuItem onClick={() => column.pin(false)}>
              <PinOff className="text-muted-foreground/70" />
              {t("table.unpinColumn")}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => column.pin("left")}>
                <Pin className="text-muted-foreground/70" />
                {t("table.pinColumnStart")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => column.pin("right")}>
                <Pin className="text-muted-foreground/70" />
                {t("table.pinColumnEnd")}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
            <EyeOff className="text-muted-foreground/70" />
            {t("table.hideColumn")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showFilterAffordance && (
        <ColumnFilterPopover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          value={filterValue}
          onChange={(value) => column.setFilterValue(value || undefined)}
          title={title}
        />
      )}
    </div>
  );
}

/** Per-column sticky filter — a small trigger + popover instead of an always-visible filter row, so no column ever shifts layout just because filtering exists (TASK-060B Part 3). */
function ColumnFilterPopover({
  open,
  onOpenChange,
  value,
  onChange,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  title: string;
}) {
  const { t } = useLocale();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "size-6 text-muted-foreground/60 hover:text-foreground",
            value && "text-primary",
          )}
          aria-label={t("table.filterColumn")}
        >
          <Filter className="size-3" />
        </EnterpriseButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <p className="mb-1.5 text-caption font-medium text-muted-foreground">{title}</p>
        <SearchInput
          autoFocus
          value={value}
          onValueChange={onChange}
          placeholder={t("table.filterPlaceholder")}
          clearLabel={t("table.clearFilter")}
          className="max-w-none"
        />
      </PopoverContent>
    </Popover>
  );
}
