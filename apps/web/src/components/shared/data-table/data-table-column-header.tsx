"use client";

import { useState } from "react";
import type { Column } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  EllipsisVertical,
  EyeOff,
  Filter,
  Pin,
  PinOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EnterpriseButton } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/locale-provider";

type HeaderAlign = "start" | "center" | "end";

/**
 * Column header (design-system §6):
 *
 * - ONE click on the label sorts: ascending → descending → unsorted (Shift
 *   adds a secondary sort in client mode). The sort arrow is always visible
 *   while the column is sorted; unsorted sortable columns show a faint
 *   affordance on hover/focus only.
 * - The column menu (filter / pin / hide) lives on its own small trigger.
 * - The label sits flush on the column's alignment edge — the same edge the
 *   body and footer cells use. The sort arrow follows the label away from
 *   that edge, and the menu/filter/pin controls sit at the opposite side, so
 *   no icon ever shifts the label off the value axis.
 */
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
  /** Client mode only — Shift+click adds a secondary sort; server mode sorts by one field. */
  canMultiSort?: boolean;
}) {
  const { t } = useLocale();
  const [filterOpen, setFilterOpen] = useState(false);
  const isPinned = column.getIsPinned();
  const filterValue = (column.getFilterValue() as string | undefined) ?? "";
  const showFilter = canFilter && column.getCanFilter();
  const canSort = column.getCanSort();
  const canPin = column.getCanPin();
  const canHide = column.getCanHide();
  const hasMenu = showFilter || canPin || canHide;
  const sorted = column.getIsSorted();
  const SortIcon = sorted === "desc" ? ArrowDown : sorted === "asc" ? ArrowUp : ChevronsUpDown;

  const labelContent = (
    <>
      <span className="min-w-0 truncate">{title}</span>
      {canSort ? (
        <SortIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            sorted
              ? "text-foreground"
              : "opacity-0 transition-opacity duration-(--duration-base) group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
          )}
        />
      ) : null}
    </>
  );

  const label = canSort ? (
    <button
      type="button"
      className={cn(
        "group/sort flex min-w-0 items-center gap-1 rounded-xs hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        align === "end" && "flex-row-reverse",
        sorted && "text-foreground",
      )}
      onClick={(event) => {
        const multi = canMultiSort && event.shiftKey;
        const next = column.getNextSortingOrder();
        if (next === false) column.clearSorting();
        else column.toggleSorting(next === "desc", multi);
      }}
    >
      {labelContent}
    </button>
  ) : (
    <span className="flex min-w-0 items-center">{labelContent}</span>
  );

  const controls =
    hasMenu || isPinned || filterValue ? (
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5",
          align === "end" ? "me-auto" : align === "start" ? "ms-auto" : "",
        )}
      >
        {isPinned ? <Pin aria-hidden className="size-3 shrink-0 text-muted-foreground" /> : null}
        {filterValue ? (
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-5 text-primary"
            aria-label={t("table.filterColumn")}
            onClick={() => setFilterOpen(true)}
          >
            <Filter className="size-3" />
          </EnterpriseButton>
        ) : null}
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("table.columnMenu", { column: title })}
                className="size-5 text-muted-foreground opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <EllipsisVertical className="size-3.5" />
              </EnterpriseButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {showFilter ? (
                <DropdownMenuItem onSelect={() => setFilterOpen(true)}>
                  <Filter className="text-muted-foreground/70" />
                  {t("table.filterColumn")}
                </DropdownMenuItem>
              ) : null}
              {showFilter && (canPin || canHide) ? <DropdownMenuSeparator /> : null}
              {canPin ? (
                isPinned ? (
                  <DropdownMenuItem onSelect={() => column.pin(false)}>
                    <PinOff className="text-muted-foreground/70" />
                    {t("table.unpinColumn")}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onSelect={() => column.pin("left")}>
                      <Pin className="text-muted-foreground/70" />
                      {t("table.pinColumnStart")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => column.pin("right")}>
                      <Pin className="text-muted-foreground/70" />
                      {t("table.pinColumnEnd")}
                    </DropdownMenuItem>
                  </>
                )
              ) : null}
              {canPin && canHide ? <DropdownMenuSeparator /> : null}
              {canHide ? (
                <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
                  <EyeOff className="text-muted-foreground/70" />
                  {t("table.hideColumn")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    ) : null;

  return (
    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "group/header flex min-w-0 w-full items-center gap-1",
            align === "end" && "flex-row-reverse",
            align === "center" && "justify-center",
            className,
          )}
        >
          {label}
          {controls}
        </div>
      </PopoverAnchor>
      {showFilter ? (
        <PopoverContent align="start" className="w-56 p-2">
          <p className="mb-1.5 text-caption font-medium text-muted-foreground">{title}</p>
          <SearchInput
            autoFocus
            value={filterValue}
            onValueChange={(value) => column.setFilterValue(value || undefined)}
            placeholder={t("table.filterPlaceholder")}
            clearLabel={t("table.clearFilter")}
            className="max-w-none"
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
