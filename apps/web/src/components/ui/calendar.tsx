"use client";

import * as React from "react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { enterpriseButtonVariants } from "@/components/ui/button";
import { MONTH_ABBR, WEEKDAY_ABBR } from "@/lib/date";

/**
 * The ONE calendar grid every date-picking surface in OMS uses (Design
 * System Unification task) — a thin styling layer over `react-day-picker`,
 * never a hand-rolled day grid. Default caption is a plain centered label
 * with exactly one previous/one next button — never the dropdown
 * month/year selectors `react-day-picker` offers, which read as a generic
 * booking-website widget rather than an enterprise ERP (a caller can still
 * opt into `captionLayout="dropdown"` explicitly if a future surface
 * genuinely needs it, but nothing in OMS does today). Month/weekday
 * captions always render in English abbreviated form via `formatters`,
 * regardless of the active app locale — the ERP's date system stays
 * internationally unambiguous even when the surrounding UI is in Arabic;
 * only layout mirrors via `dir`.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  navLayout = "around",
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      navLayout={navLayout}
      formatters={{
        formatMonthDropdown: (month) => MONTH_ABBR[month.getMonth()],
        formatCaption: (month) => `${MONTH_ABBR[month.getMonth()]} ${month.getFullYear()}`,
        formatWeekdayName: (weekday) => WEEKDAY_ABBR[weekday.getDay()],
      }}
      className={cn("p-2", className)}
      classNames={{
        months: "flex flex-col gap-2",
        // Previous button / caption / next button share one grid row (`auto
        // 1fr auto`) so the header height is whatever its content needs and
        // the three controls can never overlap — no absolute positioning.
        month: "grid grid-cols-[auto_1fr_auto] items-center gap-x-1 gap-y-2",
        month_caption: "col-start-2 flex h-8 items-center justify-center",
        caption_label: "text-caption font-semibold",
        dropdowns: "flex items-center gap-1.5",
        dropdown_root:
          "relative rounded-xs border border-input bg-card text-caption font-medium shadow-xs has-focus:border-ring",
        dropdown: "absolute inset-0 cursor-pointer opacity-0",
        button_previous: cn(
          enterpriseButtonVariants({ variant: "ghost", size: "icon-sm" }),
          "col-start-1 rounded-xs disabled:opacity-30",
        ),
        button_next: cn(
          enterpriseButtonVariants({ variant: "ghost", size: "icon-sm" }),
          "col-start-3 rounded-xs disabled:opacity-30",
        ),
        month_grid: "col-span-3 w-full border-collapse",
        weekdays: "flex",
        weekday: "w-8 rounded-xs text-caption font-medium text-muted-foreground",
        week: "mt-0.5 flex w-full",
        day: "relative size-8 p-0 text-center text-caption focus-within:relative focus-within:z-20",
        day_button: cn(
          enterpriseButtonVariants({ variant: "ghost" }),
          "size-8 rounded-xs border-transparent p-0 font-normal aria-selected:opacity-100",
        ),
        today: "[&>button]:border-primary/40 [&>button]:font-semibold [&>button]:text-primary",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:shadow-xs [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        outside: "text-muted-foreground/50",
        disabled: "text-muted-foreground/40 opacity-50",
        range_start: "[&>button]:rounded-s-xs [&>button]:rounded-e-none",
        range_end: "[&>button]:rounded-e-xs [&>button]:rounded-s-none",
        range_middle:
          "bg-primary/10 [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-3.5", chevronClassName)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn("size-3.5", chevronClassName)} {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}
