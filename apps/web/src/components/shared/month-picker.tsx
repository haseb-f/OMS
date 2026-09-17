"use client";

import { useEffect, useState } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import {
  MONTH_ABBR,
  currentMonthValue,
  formatMonthValue,
  parseMonthValue,
  toMonthValue,
} from "@/lib/date";

/**
 * The ONE month/period picker in OMS — never the browser's native
 * `<input type="month">`, whose widget is unstyleable, renders a different
 * control in every browser, and shows the month in the OS locale (so an
 * Arabic OS produced Arabic-Indic digits inside an app that standardises on
 * English ones).
 *
 * Value is the API's own `"YYYY-MM"` period string, so callers pass it
 * straight through with no conversion. Layout mirrors in RTL while the month
 * abbreviations and the year stay English, exactly like `Calendar`.
 */
export function EnterpriseMonthPicker({
  value,
  onChange,
  placeholder = "MMM YYYY",
  disabled,
  className,
  id,
  allowClear = false,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Adds a Clear action, for a filter where "any period" is a valid state. */
  allowClear?: boolean;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
}) {
  const { t, direction } = useLocale();
  const [open, setOpen] = useState(false);
  const selected = parseMonthValue(value);
  // The year the grid is *browsing*, which the user can page away from
  // without changing the selection.
  const [viewYear, setViewYear] = useState(() => selected?.year ?? new Date().getFullYear());

  useEffect(() => {
    if (open && selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewYear(selected.year);
    }
    // Re-syncing only on open keeps paging stable while the popover is up.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (monthIndex: number) => {
    onChange(toMonthValue(viewYear, monthIndex));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <EnterpriseButton
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-invalid={ariaInvalid || undefined}
          aria-label={ariaLabel}
          className={cn(
            "h-(--control-height-sm) justify-between gap-2 font-normal",
            className ?? "w-(--width-control-date)",
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")} dir="ltr">
            {formatMonthValue(value) || placeholder}
          </span>
          <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </EnterpriseButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        dir={direction}
        className="w-auto rounded-xs border border-border bg-card p-0 shadow-md"
      >
        {/* Year pager mirrors `Calendar`'s header: one previous, one next,
            centred label — never a year dropdown. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-1 p-2 pb-0">
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-xs"
            aria-label={t("monthPicker.previousYear")}
            onClick={() => setViewYear((year) => year - 1)}
          >
            {direction === "rtl" ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronLeft className="size-3.5" />
            )}
          </EnterpriseButton>
          <span className="text-center text-caption font-semibold" dir="ltr">
            {viewYear}
          </span>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-xs"
            aria-label={t("monthPicker.nextYear")}
            onClick={() => setViewYear((year) => year + 1)}
          >
            {direction === "rtl" ? (
              <ChevronLeft className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </EnterpriseButton>
        </div>
        <div className="grid grid-cols-3 gap-1 p-2" role="grid">
          {MONTH_ABBR.map((label, monthIndex) => {
            const isSelected = selected?.year === viewYear && selected.monthIndex === monthIndex;
            return (
              <EnterpriseButton
                key={label}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isSelected}
                className={cn(
                  "w-14 justify-center rounded-xs font-normal",
                  isSelected &&
                    "bg-primary text-primary-foreground shadow-xs hover:bg-primary hover:text-primary-foreground",
                )}
                onClick={() => select(monthIndex)}
              >
                {label}
              </EnterpriseButton>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-2.5">
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(currentMonthValue());
              setOpen(false);
            }}
          >
            {t("monthPicker.currentMonth")}
          </EnterpriseButton>
          {allowClear ? (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {t("datePicker.clear")}
            </EnterpriseButton>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
