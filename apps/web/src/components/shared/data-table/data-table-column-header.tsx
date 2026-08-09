"use client";

import { useState } from "react";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff, Filter, PinOff, Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const justifyClass: Record<HeaderAlign, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
};

const textAlignClass: Record<HeaderAlign, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
};

/** Cancels the sort-trigger button's own horizontal padding on the side that would otherwise push it away from the column's true edge — center needs no correction since that padding is symmetric. */
const edgeMarginClass: Record<HeaderAlign, string> = {
  start: "-ms-2.5",
  center: "",
  end: "-me-2.5",
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

  if (!column.getCanSort()) {
    return (
      <div className={cn("flex items-center gap-1", justifyClass[align], className)}>
        <span className={textAlignClass[align]}>{title}</span>
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

  const isSorted = column.getIsSorted();
  const Icon = isSorted === "desc" ? ArrowDown : isSorted === "asc" ? ArrowUp : ChevronsUpDown;

  return (
    <div className={cn("group/sort flex items-center gap-0.5", justifyClass[align], className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EnterpriseButton
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 gap-1.5 font-semibold tracking-wide text-muted-foreground data-[state=open]:bg-accent hover:text-foreground",
              edgeMarginClass[align],
            )}
          >
            <span>{title}</span>
            {isPinned && <Pin className="size-3 text-muted-foreground/70" />}
            <Icon
              className={cn(
                "size-3.5 text-muted-foreground/60 transition-opacity duration-150 group-hover/sort:opacity-100",
                !isSorted && "opacity-0 group-hover/sort:opacity-70",
                isSorted && "text-foreground opacity-100",
              )}
            />
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
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            inputSize="sm"
            value={value}
            placeholder={t("table.filterPlaceholder")}
            onChange={(event) => onChange(event.target.value)}
          />
          {value && (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("table.clearFilter")}
              onClick={() => onChange("")}
            >
              <X className="size-3.5" />
            </EnterpriseButton>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
